/**
 * Shopify Storefront adapter for Catch Comics.
 *
 * Fetches a retailer's full product catalog from their public /products.json
 * endpoint, normalises each product to our retailer_listings schema, attempts
 * canonical product matching via ISBN-13 / EAN, and upserts to the database.
 *
 * Public API:
 *   const adapter = new ShopifyAdapter()
 *   const result  = await adapter.syncRetailer(retailerId)    // full DB sync
 *   const preview = await adapter.previewRetailer(domain)     // dry-run, no DB
 *
 * Design notes:
 * - Pagination: /products.json?limit=250&page=N, stop on empty array.
 *   Hard cap at MAX_PAGES (100) ≈ 25 000 products.
 * - Rate limiting: 2 s delay between pages; 429/5xx → exponential back-off
 *   (2 s, 4 s, 8 s … max 60 s), up to 3 retries.
 * - Two-consecutive-syncs rule: products missing from a single sync are NOT
 *   immediately marked OUT_OF_STOCK (could be a transient pagination gap).
 *   Missing SKUs are stored in retailers.sync_config.prev_missing_skus; only
 *   items missing from two consecutive syncs get marked OUT_OF_STOCK.
 * - Batching: upserts are currently serial. For stores > 5 000 products,
 *   a future iteration should batch findMany + createMany/updateMany.
 */

import { prisma }          from '@/lib/prisma'
import {
  ListingCondition,
  MatchMethod,
  Prisma,
  StockStatus,
} from '@prisma/client'
import {
  extractIdentifiers,
  matchCanonical,
  type SyncResult,
  type SyncError,
} from '@/lib/adapters/shared/matching'

// ── Shopify API shapes ────────────────────────────────────────────────────────

interface ShopifyImage {
  src: string
}

interface ShopifyVariant {
  id: number
  title: string
  /** String decimal, e.g. "12.99" */
  price: string
  sku: string
  barcode: string | null
  available: boolean
}

interface ShopifyProduct {
  id: number
  title: string
  handle: string
  body_html: string | null
  /** Shopify product_type field — e.g. "Graphic Novel", "Manga", "Comic", "" */
  product_type: string | null
  /** Shopify tags array — e.g. ["TYPE|Graphic Novel", "GENRE|Superhero"] */
  tags: string[]
  images: ShopifyImage[]
  variants: ShopifyVariant[]
}

interface ShopifyProductsPage {
  products: ShopifyProduct[]
}

// ── sync_config JSON contract for Shopify retailers ───────────────────────────
// Stored in retailers.sync_config (Prisma Json field).

interface ShopifySyncConfig {
  /** SKUs that were absent from the previous sync run. */
  prev_missing_skus?: string[]
  /** Set when the /products.json endpoint returns 404. */
  disabled_reason?: string
  disabled_at?: string
  /**
   * When true, only sync products whose Shopify `product_type` is in the comic
   * allowlist (manga, graphic novel, comic, comics, trade paperback, hardcover,
   * single issue). All other product types are silently skipped.
   *
   * Safe default is false (off) — existing retailers are unaffected unless this
   * flag is explicitly set in their sync_config via the admin panel or a migration.
   *
   * Rationale: general hobby retailers (e.g. Travelling Man) carry board games,
   * miniatures, and merchandise alongside comics. Without this filter, non-comic
   * listings pollute the canonical graph.
   */
  comic_filter?: boolean
  [key: string]: unknown
}

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * One normalised listing ready for preview or DB upsert.
 * The canonical match fields are null when no match was found.
 */
export interface NormalizedListing {
  retailerSku: string
  retailerUrl: string
  title: string
  /** Fixed-precision decimal string, e.g. "12.99" */
  priceAmount: string
  priceCurrency: string
  stockStatus: StockStatus
  condition: ListingCondition
  conditionDetail: string | null
  imageUrl: string | null
  isbn13: string | null
  ean: string | null
  rawData: ShopifyProduct
  canonicalProductId: string | null
  matchMethod: MatchMethod
  matchConfidence: number
}

// Re-export shared types so existing importers (dispatch.ts etc.) keep working
export type { SyncResult, SyncError }

// ── Constants ─────────────────────────────────────────────────────────────────

const USER_AGENT          = 'CatchComics/1.0 (+https://catchcomics.com/bot)'
const PAGE_SIZE           = 250
const MAX_PAGES           = 100
const BETWEEN_PAGE_MS     = 2_000
const MAX_FETCH_RETRIES   = 3

/**
 * Shopify product_type values that are definitely comics/manga/graphic novels.
 * All values are lower-cased for comparison.
 *
 * Used by the opt-in comic_filter (sync_config.comic_filter = true).
 * Mirrors the set in scripts/day5-tm-controlled-sync.ts.
 *
 * Extended to cover common UK comic/manga retailer product_type labels,
 * including collected editions, back issues, format shorthands, and art books.
 */
const COMIC_PRODUCT_TYPES = new Set([
  // Original values
  'manga',
  'graphic novel',
  'comic',
  'comics',
  'trade paperback',
  'hardcover',
  'single issue',
  // Plural / alternate spellings
  'graphic novels',
  // Format shorthands
  'tpb',
  // Collected edition variants
  'omnibus',
  'compendium',
  'collected edition',
  'collected editions',
  'deluxe edition',
  'absolute edition',
  'collected volume',
  // Back issues
  'back issue',
  'back issues',
  // Floppy / single-issue slang
  'floppies',
  'floppy',
  // Bundles
  'box set',
  // Manga-specific volume label
  'manga volume',
  // Art books (some UK retailers tag these alongside comics)
  'art book',
])

// ── Utilities ─────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/**
 * Fetch with exponential back-off on 429 / 5xx.
 * Honours the Retry-After header when present.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = MAX_FETCH_RETRIES,
): Promise<Response> {
  let backoffMs = 2_000
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, init)
    // Success or a client error we shouldn't retry (e.g. 404)
    if (res.status < 429 || (res.status >= 400 && res.status < 429)) return res
    if (res.status !== 429 && res.status < 500) return res
    if (attempt === maxRetries) return res   // let caller handle the final status

    const retryAfterSec = parseInt(res.headers.get('Retry-After') ?? '0', 10)
    const waitMs = Math.min(
      retryAfterSec > 0 ? retryAfterSec * 1_000 : backoffMs,
      60_000,
    )
    console.warn(
      `[shopify] HTTP ${res.status} — attempt ${attempt + 1}/${maxRetries + 1},` +
      ` waiting ${waitMs}ms before retry`,
    )
    await sleep(waitMs)
    backoffMs = Math.min(backoffMs * 2, 60_000)
  }
  /* istanbul ignore next */
  throw new Error('fetchWithRetry: should not reach here')
}

// extractIdentifiers / makeCanonicalSlug / matchCanonical imported from shared/matching.ts

// ── Condition mapping ─────────────────────────────────────────────────────────

/**
 * Map a Shopify variant title to a ListingCondition.
 *
 * Many comic retailers encode condition in variant titles:
 *   "Near Mint", "VG", "CGC 9.8", "Reading Copy" etc.
 * We store the original title in conditionDetail for graded/degraded items.
 */
function mapVariantCondition(variantTitle: string): {
  condition: ListingCondition
  conditionDetail: string | null
} {
  const t = variantTitle.toLowerCase().trim()

  // Graded (slabbed) — check before keyword rules because grade labels
  // often contain "near mint", "very fine" etc.
  if (/\b(cgc|pgx|cbcs|sgc)\b/.test(t) || t.includes('graded')) {
    return { condition: ListingCondition.GRADED, conditionDetail: variantTitle }
  }
  if (/\bnear\s*mint\b|\bnm\b/.test(t)) {
    return { condition: ListingCondition.LIKE_NEW, conditionDetail: variantTitle }
  }
  if (/\bvery\s*good\b|\bvg\b/.test(t)) {
    return { condition: ListingCondition.VERY_GOOD, conditionDetail: variantTitle }
  }
  if (/\bgood\b|\bgd\b/.test(t)) {
    return { condition: ListingCondition.GOOD, conditionDetail: variantTitle }
  }
  if (/\bacceptable\b|\bfair\b|\bfine\b|\bfn\b/.test(t)) {
    return { condition: ListingCondition.ACCEPTABLE, conditionDetail: variantTitle }
  }
  if (/\bpoor\b|\breading\s*copy\b/.test(t)) {
    return { condition: ListingCondition.POOR, conditionDetail: variantTitle }
  }
  // Shopify's default single-variant title — plain new retail stock
  if (t === '' || t === 'default title' || t === 'new') {
    return { condition: ListingCondition.NEW, conditionDetail: null }
  }

  // Edition / cover / format designators — common on comic Shopify stores.
  // e.g. "Standard Cover", "DM Only", "Rafael Kayanan Cover (Regular Edition)",
  //      "Joe Madureira Cover (DM Only)", "Foil Variant", "Deluxe Edition"
  // These identify which version of the product is sold, NOT its physical condition.
  // Storing them as conditionDetail would be misleading — they are not conditions.
  if (/\bcover\b|\bedition\b|\bdm\s+only\b|\bvariant\b|\bfoil\b/.test(t)) {
    return { condition: ListingCondition.NEW, conditionDetail: null }
  }

  // Final fallback: title didn't match any condition keyword or edition pattern.
  // For Shopify storefronts (retail) the safe default is NEW — most unrecognised
  // variant titles are size, colour, or format labels, not condition grades.
  // UNGRADED is reserved for marketplace listings (e.g. eBay) where condition
  // is genuinely unspecified by the seller.
  return { condition: ListingCondition.NEW, conditionDetail: null }
}

// ── Variant splitting logic ───────────────────────────────────────────────────

/**
 * True when the variants carry at least two distinct non-empty barcodes,
 * meaning each variant represents a genuinely different product (e.g. different
 * editions) rather than just a condition grading of the same item.
 */
function shouldSplitVariants(variants: ShopifyVariant[]): boolean {
  const barcodes = variants
    .map(v => v.barcode?.replace(/\D/g, '') ?? '')
    .filter(b => b.length > 0)
  if (barcodes.length < 2) return false
  return new Set(barcodes).size > 1
}

// ── Normalisation ─────────────────────────────────────────────────────────────

type PreMatchListing = Omit<
  NormalizedListing,
  'canonicalProductId' | 'matchMethod' | 'matchConfidence'
>

function normalizeVariant(
  product: ShopifyProduct,
  variant: ShopifyVariant,
  domain: string,
  currency: string,
  /** Append variant ID to SKU when splitting; null → use product ID alone */
  splitSuffix: string | null,
): PreMatchListing {
  // Try barcode first (WoB style); fall back to SKU if barcode yields nothing
  // (Travelling Man stores bare ISBN-13s in the SKU field instead of barcode)
  const fromBarcode = extractIdentifiers(variant.barcode)
  const { isbn13, ean } = fromBarcode.isbn13 || fromBarcode.ean
    ? fromBarcode
    : extractIdentifiers(variant.sku)
  const { condition, conditionDetail } = mapVariantCondition(variant.title)

  return {
    retailerSku:   splitSuffix !== null ? `${product.id}-${variant.id}` : String(product.id),
    retailerUrl:   `https://${domain}/products/${product.handle}`,
    title:         product.title,
    priceAmount:   parseFloat(variant.price).toFixed(2),
    priceCurrency: currency,
    stockStatus:   variant.available ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK,
    condition,
    conditionDetail,
    imageUrl:      product.images[0]?.src ?? null,
    isbn13,
    ean,
    rawData:       product,
  }
}

/**
 * Expand one ShopifyProduct into one or more PreMatchListings.
 */
function expandProduct(
  product: ShopifyProduct,
  domain: string,
  currency: string,
): PreMatchListing[] {
  if (product.variants.length === 0) return []

  if (shouldSplitVariants(product.variants)) {
    return product.variants.map(v =>
      normalizeVariant(product, v, domain, currency, String(v.id)),
    )
  }

  // Single listing — prefer the first variant marked available
  const primary = product.variants.find(v => v.available) ?? product.variants[0]
  return [normalizeVariant(product, primary, domain, currency, null)]
}

// matchCanonical from shared/matching.ts — called below with adapterTag '[shopify]'

// ── DB upsert ─────────────────────────────────────────────────────────────────

async function upsertListing(
  retailerId: string,
  listing:    NormalizedListing,
  syncStart:  Date,
): Promise<'created' | 'updated' | 'price_changed'> {
  const existing = await prisma.retailerListing.findUnique({
    where: {
      retailerId_retailerSku: { retailerId, retailerSku: listing.retailerSku },
    },
  })

  if (!existing) {
    // New listing — create with nested initial price_history row
    await prisma.retailerListing.create({
      data: {
        retailerId,
        retailerSku:       listing.retailerSku,
        retailerUrl:       listing.retailerUrl,
        title:             listing.title,
        priceAmount:       listing.priceAmount,
        priceCurrency:     listing.priceCurrency,
        stockStatus:       listing.stockStatus,
        condition:         listing.condition,
        conditionDetail:   listing.conditionDetail,
        imageUrl:          listing.imageUrl,
        // isbn13 / ean added in migration 20260511200000; prisma generate picks them up
        ...({ isbn13: listing.isbn13, ean: listing.ean } as object),
        rawData:           listing.rawData as unknown as Prisma.InputJsonValue,
        canonicalProductId: listing.canonicalProductId,
        matchMethod:       listing.matchMethod,
        matchConfidence:   listing.matchConfidence,
        firstSeenAt:       syncStart,
        lastSeenAt:        syncStart,
        priceHistory: {
          create: {
            priceAmount:   listing.priceAmount,
            priceCurrency: listing.priceCurrency,
            stockStatus:   listing.stockStatus,
            recordedAt:    syncStart,
          },
        },
      },
    })
    return 'created'
  }

  // Existing listing — check whether price changed
  const newDecimal = new Prisma.Decimal(listing.priceAmount)
  const priceChanged = !existing.priceAmount.equals(newDecimal)

  // Only overwrite canonical match data if the listing was previously unmatched
  const matchUpdate =
    existing.matchMethod === MatchMethod.UNMATCHED && listing.canonicalProductId
      ? {
          canonicalProductId: listing.canonicalProductId,
          matchMethod:        listing.matchMethod,
          matchConfidence:    listing.matchConfidence,
        }
      : {}

  await prisma.retailerListing.update({
    where: { id: existing.id },
    data: {
      lastSeenAt:    syncStart,
      stockStatus:   listing.stockStatus,
      priceAmount:   listing.priceAmount,
      title:         listing.title,
      imageUrl:      listing.imageUrl,
      rawData:       listing.rawData as unknown as Prisma.InputJsonValue,
      ...(priceChanged ? { lastPriceChangeAt: syncStart } : {}),
      ...matchUpdate,
    },
  })

  if (priceChanged) {
    await prisma.priceHistory.create({
      data: {
        retailerListingId: existing.id,
        priceAmount:       listing.priceAmount,
        priceCurrency:     listing.priceCurrency,
        stockStatus:       listing.stockStatus,
        recordedAt:        syncStart,
      },
    })
    return 'price_changed'
  }

  return 'updated'
}

// ── Main adapter class ────────────────────────────────────────────────────────

export class ShopifyAdapter {
  // ── Dry-run preview (no DB) ─────────────────────────────────────────────────

  /**
   * Fetch a single page from a Shopify store and return normalised listings.
   * No database reads or writes. Useful for inspecting a new retailer before
   * adding them to production.
   *
   * @param domain   Bare domain, e.g. "forbiddenplanet.com"
   * @param currency ISO 4217 currency code (default "GBP")
   * @param page     Which page to fetch (default 1)
   */
  async previewRetailer(
    domain:   string,
    currency = 'GBP',
    page     = 1,
  ): Promise<NormalizedListing[]> {
    const url = `https://${domain}/products.json?limit=${PAGE_SIZE}&page=${page}`
    const res = await fetchWithRetry(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    })

    if (res.status === 403) {
      throw new Error(
        `HTTP 403 — ${domain} has blocked the public /products.json endpoint.\n` +
        `This is a deliberate store setting, not a transient error.\n` +
        `Options: (1) use their official partner/wholesale API, ` +
        `(2) request access, or (3) remove this retailer from Shopify sync.`,
      )
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${url}`)
    }

    const body     = await res.json() as ShopifyProductsPage
    const products = body.products ?? []

    return products.flatMap(product => {
      const pre = expandProduct(product, domain, currency)
      return pre.map(p => ({
        ...p,
        // No DB match in preview — mark as unmatched
        canonicalProductId: null,
        matchMethod:        MatchMethod.UNMATCHED,
        matchConfidence:    0,
      }))
    })
  }

  // ── Full sync ───────────────────────────────────────────────────────────────

  /**
   * Sync a retailer's entire Shopify catalog into the database.
   *
   * @param retailerId  UUID from the retailers table.
   * @param maxPages    Optional page cap for controlled tests (default: MAX_PAGES).
   */
  async syncRetailer(retailerId: string, maxPages = MAX_PAGES): Promise<SyncResult> {
    const startedAt = Date.now()
    const syncStart = new Date()

    const errors: SyncError[] = []
    let pagesFetched    = 0
    let productsFetched = 0
    let listingsCreated = 0
    let listingsUpdated = 0
    let priceChanges    = 0

    // ── 1. Load retailer ──────────────────────────────────────────────────────
    const retailer = await prisma.retailer.findUniqueOrThrow({
      where: { id: retailerId },
    })

    // Hard guard: this adapter must only be called for SHOPIFY retailers.
    // Retailers classified as DIRECT_AFFILIATE (e.g. Forbidden Planet),
    // AWIN_FEED, CJ_FEED, or MANUAL have no /products.json endpoint and
    // must never be passed to this adapter.
    if (retailer.platform !== 'SHOPIFY') {
      throw new Error(
        `ShopifyAdapter.syncRetailer called for ${retailer.domain} ` +
        `(platform=${retailer.platform}). ` +
        `This adapter only supports SHOPIFY retailers. ` +
        `Use the appropriate adapter for platform=${retailer.platform}.`,
      )
    }

    const domain   = retailer.domain
    const currency = retailer.currency
    const syncCfg  = (retailer.syncConfig ?? {}) as ShopifySyncConfig
    const prevMissingSkus = new Set<string>(syncCfg.prev_missing_skus ?? [])

    const seenSkus       = new Set<string>()
    const applyComicFilter = syncCfg.comic_filter === true
    let   filteredOut    = 0

    // Tracks whether pagination was aborted early due to a fatal fetch error
    // (404/403/5xx).  Used in section 4 to suppress lastSyncedAt updates when
    // the sync did not complete normally — prevents a failed sync from looking
    // like a successful one in the retailer record.
    let paginationAborted = false

    // Collects syncConfig fields written during the pagination loop (e.g.
    // disabled_reason / disabled_at set by the 404 handler).  Merged into
    // section 4's syncConfig update so they are not silently overwritten by
    // the old syncCfg spread.
    let runtimeSyncCfgOverrides: Partial<ShopifySyncConfig> = {}

    console.log(
      `[shopify] starting sync for ${domain} (retailer ${retailerId})` +
      (applyComicFilter ? ' [comic_filter=true]' : ''),
    )

    // ── 2. Paginate /products.json ────────────────────────────────────────────
    paginationLoop:
    for (let page = 1; page <= maxPages; page++) {
      const url = `https://${domain}/products.json?limit=${PAGE_SIZE}&page=${page}`

      let res: Response
      try {
        res = await fetchWithRetry(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        })
      } catch (err) {
        errors.push({
          type:    'fetch',
          message: err instanceof Error ? err.message : String(err),
          context: url,
        })
        break paginationLoop
      }

      // ── Handle error status codes ───────────────────────────────────────────

      // 404 — endpoint removed; mark retailer inactive
      if (res.status === 404) {
        console.warn(`[shopify] 404 on ${domain} — marking retailer inactive`)
        runtimeSyncCfgOverrides = {
          ...runtimeSyncCfgOverrides,
          disabled_reason: 'products.json returned 404 — endpoint removed',
          disabled_at:     new Date().toISOString(),
        }
        await prisma.retailer.update({
          where: { id: retailerId },
          data: {
            isActive:  false,
            syncConfig: {
              ...syncCfg,
              ...runtimeSyncCfgOverrides,
            } satisfies ShopifySyncConfig as unknown as Prisma.InputJsonValue,
          },
        })
        errors.push({ type: 'fetch', message: '404 — retailer marked inactive', context: url })
        paginationAborted = true
        break paginationLoop
      }

      // 403 — store has deliberately disabled the public catalog endpoint.
      // This is a permanent configuration choice, not a transient error.
      // We do NOT mark is_active=false (the store may still be reachable via
      // another method in future), but we record it in sync_config so operators
      // know why syncs are failing.
      if (res.status === 403) {
        console.warn(`[shopify] 403 on ${domain} — /products.json is blocked`)
        runtimeSyncCfgOverrides = {
          ...runtimeSyncCfgOverrides,
          disabled_reason: 'products.json returned 403 — store has blocked the public catalog endpoint',
          disabled_at:     new Date().toISOString(),
        }
        await prisma.retailer.update({
          where: { id: retailerId },
          data: {
            syncConfig: {
              ...syncCfg,
              ...runtimeSyncCfgOverrides,
            } satisfies ShopifySyncConfig as unknown as Prisma.InputJsonValue,
          },
        })
        errors.push({
          type:    'fetch',
          message: '403 — /products.json is blocked by this store; sync_config updated',
          context: url,
        })
        paginationAborted = true
        break paginationLoop
      }

      if (!res.ok) {
        errors.push({
          type:    'fetch',
          message: `HTTP ${res.status} ${res.statusText}`,
          context: url,
        })
        // For persistent 5xx after retries, abort this sync run
        paginationAborted = true
        break paginationLoop
      }

      const body     = await res.json() as ShopifyProductsPage
      const products = body.products ?? []

      // Empty page = end of catalog
      if (products.length === 0) break paginationLoop

      pagesFetched++
      productsFetched += products.length
      console.log(`[shopify] page ${page}: ${products.length} products`)

      // ── 3. Normalise + upsert each product ──────────────────────────────────
      for (const product of products) {
        // Opt-in comic filter — skip non-comic product types when enabled.
        // Silently counted; does not generate an error entry.
        //
        // When product_type is absent/empty we fall back to scanning the tags
        // array for a "TYPE|<value>" tag whose value is in COMIC_PRODUCT_TYPES.
        // This handles retailers that omit product_type but use structured tags
        // (e.g. ["TYPE|Graphic Novel", "GENRE|Superhero"]).
        if (applyComicFilter) {
          const pt = (product.product_type ?? '').toLowerCase().trim()
          const isComicType = COMIC_PRODUCT_TYPES.has(pt)
          const isComicByTag =
            !isComicType &&
            pt === '' &&
            product.tags.some(tag => {
              const lower = tag.toLowerCase()
              if (!lower.startsWith('type|')) return false
              const typeVal = lower.slice(5).trim()
              return COMIC_PRODUCT_TYPES.has(typeVal)
            })
          if (!isComicType && !isComicByTag) {
            filteredOut++
            continue
          }
        }

        let preListings: PreMatchListing[]
        try {
          preListings = expandProduct(product, domain, currency)
        } catch (err) {
          errors.push({
            type:    'normalize',
            message: err instanceof Error ? err.message : String(err),
            context: String(product.id),
          })
          continue
        }

        for (const pre of preListings) {
          let matchData: Pick<NormalizedListing, 'canonicalProductId' | 'matchMethod' | 'matchConfidence'>
          try {
            matchData = await matchCanonical(pre.isbn13, pre.ean, pre.title, '[shopify]')
          } catch (err) {
            // DB look-up failed — treat as unmatched, don't skip the listing
            errors.push({
              type:    'db',
              message: `canonical match failed: ${err instanceof Error ? err.message : err}`,
              context: pre.retailerSku,
            })
            matchData = { canonicalProductId: null, matchMethod: MatchMethod.UNMATCHED, matchConfidence: 0 }
          }

          const listing: NormalizedListing = { ...pre, ...matchData }

          try {
            const result = await upsertListing(retailerId, listing, syncStart)
            seenSkus.add(listing.retailerSku)
            if (result === 'created')       listingsCreated++
            else if (result === 'price_changed') { listingsUpdated++; priceChanges++ }
            else                            listingsUpdated++
          } catch (err) {
            errors.push({
              type:    'upsert',
              message: err instanceof Error ? err.message : String(err),
              context: pre.retailerSku,
            })
          }
        }
      }

      // Pause between pages to be polite to the store's server
      if (page < maxPages && products.length === PAGE_SIZE) {
        await sleep(BETWEEN_PAGE_MS)
      }
    }

    // ── 4. Two-consecutive-syncs OUT_OF_STOCK rule ────────────────────────────
    //
    // Find all SKUs for this retailer that we did NOT see in this sync.
    // Items that were also absent from the PREVIOUS sync (in prevMissingSkus)
    // get marked OUT_OF_STOCK. Items absent only from this sync are left as-is
    // and recorded in sync_config.prev_missing_skus for the next run.

    try {
      const allDbListings = await prisma.retailerListing.findMany({
        where:  { retailerId },
        select: { id: true, retailerSku: true, stockStatus: true },
      })

      const currentMissingSkus = new Set<string>()
      for (const row of allDbListings) {
        if (!seenSkus.has(row.retailerSku)) {
          currentMissingSkus.add(row.retailerSku)
        }
      }

      // SKUs absent from BOTH this sync and the previous one → OUT_OF_STOCK
      const toMarkOos = allDbListings.filter(
        row =>
          currentMissingSkus.has(row.retailerSku) &&
          prevMissingSkus.has(row.retailerSku) &&
          row.stockStatus !== StockStatus.OUT_OF_STOCK,
      )

      if (toMarkOos.length > 0) {
        await prisma.retailerListing.updateMany({
          where: { id: { in: toMarkOos.map(r => r.id) } },
          data:  { stockStatus: StockStatus.OUT_OF_STOCK },
        })
        console.log(`[shopify] marked ${toMarkOos.length} listings OUT_OF_STOCK (missing 2 consecutive syncs)`)
      }

      // ── 5. Update retailer ────────────────────────────────────────────────────
      // Only advance lastSyncedAt when pagination completed normally — a fatal
      // fetch error (404/403/5xx) sets paginationAborted and the timestamp must
      // not be updated, otherwise a failed sync looks like a successful one.
      // runtimeSyncCfgOverrides carries any fields set during the run (e.g.
      // disabled_reason) so they are not silently overwritten here.
      await prisma.retailer.update({
        where: { id: retailerId },
        data: {
          ...(!paginationAborted && { lastSyncedAt: syncStart }),
          syncConfig: {
            ...syncCfg,
            ...runtimeSyncCfgOverrides,
            prev_missing_skus: Array.from(currentMissingSkus),
          } satisfies ShopifySyncConfig as unknown as Prisma.InputJsonValue,
        },
      })
    } catch (err) {
      errors.push({
        type:    'db',
        message: `post-sync cleanup failed: ${err instanceof Error ? err.message : err}`,
      })
    }

    const durationMs = Date.now() - startedAt
    console.log(
      `[shopify] sync complete for ${domain}: ` +
      `${pagesFetched} pages, ${productsFetched} products` +
      (applyComicFilter ? `, ${filteredOut} filtered (non-comic)` : '') +
      `, ${listingsCreated} created, ${listingsUpdated} updated, ` +
      `${priceChanges} price changes, ${errors.length} errors — ${durationMs}ms`,
    )

    return {
      retailerId,
      domain,
      pagesFetched,
      productsFetched,
      listingsCreated,
      listingsUpdated,
      priceChanges,
      errors,
      durationMs,
    }
  }
}
