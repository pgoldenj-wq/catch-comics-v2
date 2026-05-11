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

import { prisma } from '@/lib/prisma'
import {
  ListingCondition,
  MatchMethod,
  Prisma,
  StockStatus,
} from '@prisma/client'

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

export interface SyncResult {
  retailerId: string
  domain: string
  pagesFetched: number
  productsFetched: number
  listingsCreated: number
  listingsUpdated: number
  priceChanges: number
  errors: SyncError[]
  durationMs: number
}

export interface SyncError {
  type: 'fetch' | 'normalize' | 'upsert' | 'db'
  message: string
  context?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const USER_AGENT          = 'CatchComics/1.0 (+https://catchcomics.com/bot)'
const PAGE_SIZE           = 250
const MAX_PAGES           = 100
const BETWEEN_PAGE_MS     = 2_000
const MAX_FETCH_RETRIES   = 3

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

// ── Barcode / identifier extraction ──────────────────────────────────────────

/**
 * Parse a Shopify barcode string into ISBN-13 or EAN.
 *
 * Rules:
 *   13 digits, prefix 978/979 → ISBN-13
 *   13 digits, any other prefix → EAN
 *   Anything else              → null for both
 */
function extractIdentifiers(barcode: string | null | undefined): {
  isbn13: string | null
  ean: string | null
} {
  if (!barcode) return { isbn13: null, ean: null }
  const digits = barcode.replace(/\D/g, '')
  if (digits.length !== 13) return { isbn13: null, ean: null }
  if (digits.startsWith('978') || digits.startsWith('979')) {
    return { isbn13: digits, ean: null }
  }
  return { isbn13: null, ean: digits }
}

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
  // Shopify's default single-variant title
  if (t === '' || t === 'default title' || t === 'new') {
    return { condition: ListingCondition.NEW, conditionDetail: null }
  }
  // Unknown variant label — store as detail for manual review
  return { condition: ListingCondition.UNGRADED, conditionDetail: variantTitle }
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
  const { isbn13, ean }             = extractIdentifiers(variant.barcode)
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

// ── Canonical matching ────────────────────────────────────────────────────────

async function matchCanonical(
  isbn13: string | null,
  ean:    string | null,
): Promise<Pick<NormalizedListing, 'canonicalProductId' | 'matchMethod' | 'matchConfidence'>> {
  if (isbn13) {
    const hit = await prisma.canonicalProduct.findFirst({
      where:  { isbn13 },
      select: { id: true },
    })
    if (hit) {
      return { canonicalProductId: hit.id, matchMethod: MatchMethod.ISBN, matchConfidence: 95 }
    }
  }
  if (ean) {
    const hit = await prisma.canonicalProduct.findFirst({
      where:  { ean },
      select: { id: true },
    })
    if (hit) {
      return { canonicalProductId: hit.id, matchMethod: MatchMethod.EAN, matchConfidence: 90 }
    }
  }
  return { canonicalProductId: null, matchMethod: MatchMethod.UNMATCHED, matchConfidence: 0 }
}

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
   */
  async syncRetailer(retailerId: string): Promise<SyncResult> {
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

    const seenSkus = new Set<string>()

    console.log(`[shopify] starting sync for ${domain} (retailer ${retailerId})`)

    // ── 2. Paginate /products.json ────────────────────────────────────────────
    paginationLoop:
    for (let page = 1; page <= MAX_PAGES; page++) {
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
        await prisma.retailer.update({
          where: { id: retailerId },
          data: {
            isActive:  false,
            syncConfig: {
              ...syncCfg,
              disabled_reason: 'products.json returned 404 — endpoint removed',
              disabled_at:     new Date().toISOString(),
            } satisfies ShopifySyncConfig as unknown as Prisma.InputJsonValue,
          },
        })
        errors.push({ type: 'fetch', message: '404 — retailer marked inactive', context: url })
        break paginationLoop
      }

      // 403 — store has deliberately disabled the public catalog endpoint.
      // This is a permanent configuration choice, not a transient error.
      // We do NOT mark is_active=false (the store may still be reachable via
      // another method in future), but we record it in sync_config so operators
      // know why syncs are failing.
      if (res.status === 403) {
        console.warn(`[shopify] 403 on ${domain} — /products.json is blocked`)
        await prisma.retailer.update({
          where: { id: retailerId },
          data: {
            syncConfig: {
              ...syncCfg,
              disabled_reason: 'products.json returned 403 — store has blocked the public catalog endpoint',
              disabled_at:     new Date().toISOString(),
            } satisfies ShopifySyncConfig as unknown as Prisma.InputJsonValue,
          },
        })
        errors.push({
          type:    'fetch',
          message: '403 — /products.json is blocked by this store; sync_config updated',
          context: url,
        })
        break paginationLoop
      }

      if (!res.ok) {
        errors.push({
          type:    'fetch',
          message: `HTTP ${res.status} ${res.statusText}`,
          context: url,
        })
        // For persistent 5xx after retries, abort this sync run
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
            matchData = await matchCanonical(pre.isbn13, pre.ean)
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
      if (page < MAX_PAGES && products.length === PAGE_SIZE) {
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
      await prisma.retailer.update({
        where: { id: retailerId },
        data: {
          lastSyncedAt: syncStart,
          syncConfig: {
            ...syncCfg,
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
      `${pagesFetched} pages, ${productsFetched} products, ` +
      `${listingsCreated} created, ${listingsUpdated} updated, ` +
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
