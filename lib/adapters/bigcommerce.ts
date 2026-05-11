/**
 * BigCommerce Storefront adapter for Catch Comics.
 *
 * BigCommerce does not expose a universal public catalog API, so we use
 * a two-tier probe strategy:
 *
 *   Tier 1 — /products.json (Shopify-compat layer)
 *     Some BC stores (especially those using the Cornerstone theme with the
 *     "Shopify Buy Button" app or a bespoke compatibility layer) expose a
 *     /products.json endpoint identical to Shopify's format.
 *     If GET /products.json returns 200 + { products: [...] } we use it.
 *
 *   Tier 2 — /api/storefront/catalog/products (BC Storefront REST API v3)
 *     Every BigCommerce store exposes this client-side Storefront API without
 *     authentication. Responses are a JSON array (not wrapped in { products }).
 *     Pagination: ?page=N&limit=50&include=images,variants
 *
 * Rate limiting: 2 s between pages; exponential back-off on 429/5xx.
 * Hard cap: MAX_PAGES pages × PAGE_SIZE products ≈ 12 500 products max.
 *
 * Canonical matching delegates to lib/adapters/shared/matching.ts.
 */

import { prisma }         from '@/lib/prisma'
import { ListingCondition, MatchMethod, Prisma, StockStatus } from '@prisma/client'
import {
  extractIdentifiers,
  matchCanonical,
  BaseListing,
  SyncResult,
  SyncError,
} from '@/lib/adapters/shared/matching'

export type { SyncResult, SyncError }

// ── BigCommerce API shapes ────────────────────────────────────────────────────

// Tier-1 response (Shopify-compat /products.json)
interface BCShopifyPage {
  products: BCShopifyProduct[]
}

interface BCShopifyProduct {
  id       : number
  title    : string
  handle   : string
  images   : Array<{ src: string }>
  variants : Array<{
    id      : number
    title   : string
    price   : string
    sku     : string
    barcode : string | null
    available: boolean
  }>
}

// Tier-2 response (BC Storefront API v3 — array, not wrapped)
interface BCStorefrontProduct {
  id          : number
  name        : string
  url         : string
  sku         : string
  /** Decimal price, e.g. 12.99 */
  price       : number
  /** "instock" | "outofstock" | "preorder" */
  availability: string
  images      : Array<{ url_standard: string; is_thumbnail: boolean }>
  variants    : Array<{
    id         : number
    sku        : string
    price      : number
    purchasing_disabled: boolean
    option_values: Array<{ label: string; option_display_name: string }>
  }>
}

// ── sync_config contract ──────────────────────────────────────────────────────

interface BCSyncConfig {
  /** Which tier was used on the last successful sync */
  detected_tier?      : 'shopify-compat' | 'storefront-api'
  prev_missing_skus?  : string[]
  disabled_reason?    : string
  disabled_at?        : string
  [key: string]       : unknown
}

// ── Normalized listing ────────────────────────────────────────────────────────

export interface NormalizedListing extends BaseListing {
  rawData: BCShopifyProduct | BCStorefrontProduct
}

// ── Constants ─────────────────────────────────────────────────────────────────

const USER_AGENT        = 'CatchComics/1.0 (+https://catchcomics.com/bot)'
const MAX_PAGES         = 100
const PAGE_SIZE_T1      = 250   // /products.json
const PAGE_SIZE_T2      = 50    // Storefront API (max 50)
const BETWEEN_PAGE_MS   = 2_000
const MAX_FETCH_RETRIES = 3

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

async function fetchWithRetry(url: string, init: RequestInit, retries = MAX_FETCH_RETRIES): Promise<Response> {
  let backoffMs = 2_000
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, init)
    if (res.status < 429 || (res.status >= 400 && res.status < 429)) return res
    if (res.status !== 429 && res.status < 500) return res
    if (attempt === retries) return res
    const retryAfterSec = parseInt(res.headers.get('Retry-After') ?? '0', 10)
    const waitMs = Math.min(retryAfterSec > 0 ? retryAfterSec * 1_000 : backoffMs, 60_000)
    console.warn(`[bigcommerce] HTTP ${res.status} — attempt ${attempt + 1}/${retries + 1}, waiting ${waitMs}ms`)
    await sleep(waitMs)
    backoffMs = Math.min(backoffMs * 2, 60_000)
  }
  throw new Error('fetchWithRetry: unreachable')
}

// ── Tier-1 helpers (Shopify-compat /products.json) ───────────────────────────

/**
 * Attempt a single GET /products.json?limit=1&page=1 to detect tier.
 * Returns true only when the response is 200 JSON with a `products` array.
 */
async function probeShopifyCompat(domain: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://${domain}/products.json?limit=1&page=1`,
      { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } },
    )
    if (!res.ok) return false
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('json')) return false
    const body = await res.json() as { products?: unknown }
    return Array.isArray(body.products)
  } catch {
    return false
  }
}

function normalizeT1Product(
  product : BCShopifyProduct,
  domain  : string,
  currency: string,
): Array<Omit<NormalizedListing, 'canonicalProductId' | 'matchMethod' | 'matchConfidence'>> {
  if (product.variants.length === 0) return []
  const primary = product.variants.find(v => v.available) ?? product.variants[0]
  const { isbn13, ean } = extractIdentifiers(primary.barcode)
  return [{
    retailerSku    : String(product.id),
    retailerUrl    : `https://${domain}/products/${product.handle}`,
    title          : product.title,
    priceAmount    : parseFloat(primary.price).toFixed(2),
    priceCurrency  : currency,
    stockStatus    : primary.available ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK,
    condition      : ListingCondition.NEW,
    conditionDetail: null,
    imageUrl       : product.images[0]?.src ?? null,
    isbn13,
    ean,
    rawData        : product,
  }]
}

// ── Tier-2 helpers (BC Storefront API v3) ─────────────────────────────────────

function mapBCAvailability(availability: string): StockStatus {
  switch (availability) {
    case 'instock':   return StockStatus.IN_STOCK
    case 'outofstock':return StockStatus.OUT_OF_STOCK
    case 'preorder':  return StockStatus.PREORDER
    default:          return StockStatus.UNKNOWN
  }
}

function normalizeT2Product(
  product : BCStorefrontProduct,
  currency: string,
): Array<Omit<NormalizedListing, 'canonicalProductId' | 'matchMethod' | 'matchConfidence'>> {
  // Try SKU as barcode (some BC stores put ISBN in SKU)
  const { isbn13, ean } = extractIdentifiers(product.sku)
  const thumb = product.images.find(i => i.is_thumbnail) ?? product.images[0]
  return [{
    retailerSku    : product.sku || String(product.id),
    retailerUrl    : product.url,
    title          : product.name,
    priceAmount    : product.price.toFixed(2),
    priceCurrency  : currency,
    stockStatus    : mapBCAvailability(product.availability),
    condition      : ListingCondition.NEW,
    conditionDetail: null,
    imageUrl       : thumb?.url_standard ?? null,
    isbn13,
    ean,
    rawData        : product,
  }]
}

// ── DB upsert (identical logic to Shopify adapter) ───────────────────────────

async function upsertListing(
  retailerId: string,
  listing   : NormalizedListing,
  syncStart : Date,
): Promise<'created' | 'updated' | 'price_changed'> {
  const existing = await prisma.retailerListing.findUnique({
    where: { retailerId_retailerSku: { retailerId, retailerSku: listing.retailerSku } },
  })

  if (!existing) {
    await prisma.retailerListing.create({
      data: {
        retailerId,
        retailerSku       : listing.retailerSku,
        retailerUrl       : listing.retailerUrl,
        title             : listing.title,
        priceAmount       : listing.priceAmount,
        priceCurrency     : listing.priceCurrency,
        stockStatus       : listing.stockStatus,
        condition         : listing.condition,
        conditionDetail   : listing.conditionDetail,
        imageUrl          : listing.imageUrl,
        ...({ isbn13: listing.isbn13 ?? null, ean: listing.ean ?? null } as object),
        rawData           : listing.rawData as unknown as Prisma.InputJsonValue,
        canonicalProductId: listing.canonicalProductId,
        matchMethod       : listing.matchMethod,
        matchConfidence   : listing.matchConfidence,
        firstSeenAt       : syncStart,
        lastSeenAt        : syncStart,
        priceHistory: {
          create: {
            priceAmount  : listing.priceAmount,
            priceCurrency: listing.priceCurrency,
            stockStatus  : listing.stockStatus,
            recordedAt   : syncStart,
          },
        },
      },
    })
    return 'created'
  }

  const priceChanged = !existing.priceAmount.equals(new Prisma.Decimal(listing.priceAmount))
  const matchUpdate =
    existing.matchMethod === MatchMethod.UNMATCHED && listing.canonicalProductId
      ? { canonicalProductId: listing.canonicalProductId, matchMethod: listing.matchMethod, matchConfidence: listing.matchConfidence }
      : {}

  await prisma.retailerListing.update({
    where: { id: existing.id },
    data: {
      lastSeenAt   : syncStart,
      stockStatus  : listing.stockStatus,
      priceAmount  : listing.priceAmount,
      title        : listing.title,
      imageUrl     : listing.imageUrl,
      ...({ isbn13: listing.isbn13 ?? null, ean: listing.ean ?? null } as object),
      rawData      : listing.rawData as unknown as Prisma.InputJsonValue,
      ...(priceChanged ? { lastPriceChangeAt: syncStart } : {}),
      ...matchUpdate,
    },
  })

  if (priceChanged) {
    await prisma.priceHistory.create({
      data: {
        retailerListingId: existing.id,
        priceAmount      : listing.priceAmount,
        priceCurrency    : listing.priceCurrency,
        stockStatus      : listing.stockStatus,
        recordedAt       : syncStart,
      },
    })
    return 'price_changed'
  }

  return 'updated'
}

// ── Main adapter class ────────────────────────────────────────────────────────

export class BigCommerceAdapter {

  async syncRetailer(retailerId: string): Promise<SyncResult> {
    const startedAt = Date.now()
    const syncStart = new Date()
    const errors    : SyncError[] = []
    let pagesFetched    = 0
    let productsFetched = 0
    let listingsCreated = 0
    let listingsUpdated = 0
    let priceChanges    = 0

    // ── Load retailer ──────────────────────────────────────────────────────────
    const retailer = await prisma.retailer.findUniqueOrThrow({ where: { id: retailerId } })
    if (retailer.platform !== 'BIGCOMMERCE') {
      throw new Error(
        `BigCommerceAdapter.syncRetailer called for ${retailer.domain} ` +
        `(platform=${retailer.platform}). This adapter only supports BIGCOMMERCE retailers.`,
      )
    }

    const domain   = retailer.domain
    const currency = retailer.currency
    const syncCfg  = (retailer.syncConfig ?? {}) as BCSyncConfig
    const prevMissingSkus = new Set<string>(syncCfg.prev_missing_skus ?? [])
    const seenSkus = new Set<string>()

    console.log(`[bigcommerce] starting sync for ${domain} (retailer ${retailerId})`)

    // ── Detect tier ───────────────────────────────────────────────────────────
    const useShopifyCompat = await probeShopifyCompat(domain)
    const detectedTier = useShopifyCompat ? 'shopify-compat' : 'storefront-api'
    console.log(`[bigcommerce] using tier: ${detectedTier}`)

    // ── Paginate ──────────────────────────────────────────────────────────────
    paginationLoop:
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = useShopifyCompat
        ? `https://${domain}/products.json?limit=${PAGE_SIZE_T1}&page=${page}`
        : `https://${domain}/api/storefront/catalog/products?page=${page}&limit=${PAGE_SIZE_T2}&include=images,variants`

      let res: Response
      try {
        res = await fetchWithRetry(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        })
      } catch (err) {
        errors.push({ type: 'fetch', message: err instanceof Error ? err.message : String(err), context: url })
        break paginationLoop
      }

      if (res.status === 404) {
        if (useShopifyCompat) {
          // Tier-1 disappeared mid-sync — abort; next run will re-probe
          errors.push({ type: 'fetch', message: '404 on /products.json — will re-detect tier next sync', context: url })
        } else {
          // Store not a BigCommerce store or endpoint removed
          await prisma.retailer.update({
            where: { id: retailerId },
            data: {
              isActive: false,
              syncConfig: { ...syncCfg, disabled_reason: 'storefront API 404', disabled_at: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
            },
          })
          errors.push({ type: 'fetch', message: '404 — retailer marked inactive', context: url })
        }
        break paginationLoop
      }

      if (res.status === 403) {
        errors.push({ type: 'fetch', message: `403 — ${domain} storefront API is blocked`, context: url })
        break paginationLoop
      }

      if (!res.ok) {
        errors.push({ type: 'fetch', message: `HTTP ${res.status} ${res.statusText}`, context: url })
        break paginationLoop
      }

      // ── Parse response ────────────────────────────────────────────────────────
      let preListings: Array<Omit<NormalizedListing, 'canonicalProductId' | 'matchMethod' | 'matchConfidence'>> = []

      if (useShopifyCompat) {
        const body = await res.json() as BCShopifyPage
        const products = body.products ?? []
        if (products.length === 0) break paginationLoop
        pagesFetched++
        productsFetched += products.length
        console.log(`[bigcommerce] tier-1 page ${page}: ${products.length} products`)
        for (const p of products) {
          try { preListings.push(...normalizeT1Product(p, domain, currency)) }
          catch (err) { errors.push({ type: 'normalize', message: err instanceof Error ? err.message : String(err), context: String(p.id) }) }
        }
      } else {
        const products = await res.json() as BCStorefrontProduct[]
        if (!Array.isArray(products) || products.length === 0) break paginationLoop
        pagesFetched++
        productsFetched += products.length
        console.log(`[bigcommerce] tier-2 page ${page}: ${products.length} products`)
        for (const p of products) {
          try { preListings.push(...normalizeT2Product(p, currency)) }
          catch (err) { errors.push({ type: 'normalize', message: err instanceof Error ? err.message : String(err), context: String(p.id) }) }
        }
      }

      // ── Match + upsert ────────────────────────────────────────────────────────
      for (const pre of preListings) {
        let matchData: Pick<NormalizedListing, 'canonicalProductId' | 'matchMethod' | 'matchConfidence'>
        try {
          matchData = await matchCanonical(pre.isbn13, pre.ean, pre.title, '[bigcommerce]')
        } catch (err) {
          errors.push({ type: 'db', message: `canonical match failed: ${err instanceof Error ? err.message : err}`, context: pre.retailerSku })
          matchData = { canonicalProductId: null, matchMethod: MatchMethod.UNMATCHED, matchConfidence: 0 }
        }

        const listing: NormalizedListing = { ...pre, ...matchData }
        try {
          const result = await upsertListing(retailerId, listing, syncStart)
          seenSkus.add(listing.retailerSku)
          if (result === 'created')            listingsCreated++
          else if (result === 'price_changed') { listingsUpdated++; priceChanges++ }
          else                                 listingsUpdated++
        } catch (err) {
          errors.push({ type: 'upsert', message: err instanceof Error ? err.message : String(err), context: pre.retailerSku })
        }
      }

      if (page < MAX_PAGES) await sleep(BETWEEN_PAGE_MS)
    }

    // ── Two-consecutive-syncs OUT_OF_STOCK rule ───────────────────────────────
    try {
      const allDbListings = await prisma.retailerListing.findMany({
        where: { retailerId },
        select: { id: true, retailerSku: true, stockStatus: true },
      })
      const currentMissingSkus = new Set<string>(
        allDbListings.filter(r => !seenSkus.has(r.retailerSku)).map(r => r.retailerSku),
      )
      const toMarkOos = allDbListings.filter(
        r => currentMissingSkus.has(r.retailerSku) && prevMissingSkus.has(r.retailerSku) && r.stockStatus !== StockStatus.OUT_OF_STOCK,
      )
      if (toMarkOos.length > 0) {
        await prisma.retailerListing.updateMany({
          where: { id: { in: toMarkOos.map(r => r.id) } },
          data:  { stockStatus: StockStatus.OUT_OF_STOCK },
        })
        console.log(`[bigcommerce] marked ${toMarkOos.length} listings OUT_OF_STOCK (missing 2 consecutive syncs)`)
      }
      await prisma.retailer.update({
        where: { id: retailerId },
        data: {
          lastSyncedAt: syncStart,
          syncConfig: {
            ...syncCfg,
            detected_tier       : detectedTier,
            prev_missing_skus   : Array.from(currentMissingSkus),
          } as unknown as Prisma.InputJsonValue,
        },
      })
    } catch (err) {
      errors.push({ type: 'db', message: `post-sync cleanup failed: ${err instanceof Error ? err.message : err}` })
    }

    const durationMs = Date.now() - startedAt
    console.log(
      `[bigcommerce] sync complete for ${domain}: ` +
      `${pagesFetched} pages, ${productsFetched} products, ` +
      `${listingsCreated} created, ${listingsUpdated} updated, ` +
      `${priceChanges} price changes, ${errors.length} errors — ${durationMs}ms`,
    )
    return { retailerId, domain, pagesFetched, productsFetched, listingsCreated, listingsUpdated, priceChanges, errors, durationMs }
  }
}
