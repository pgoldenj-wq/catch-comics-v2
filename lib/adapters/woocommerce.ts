/**
 * WooCommerce Storefront adapter for Catch Comics.
 *
 * Uses the WooCommerce Store API (introduced with Gutenberg Blocks) which is
 * public and requires no authentication:
 *
 *   GET https://{domain}/wp-json/wc/store/products?page=N&per_page=100
 *
 * Response shape: { items: WCProduct[], total: number, total_pages: number }
 * (or in some WC versions a raw array — we handle both)
 *
 * Price parsing:
 *   prices.price is an integer string in minor currency units (e.g. "1299" for $12.99).
 *   We divide by 10^prices.currency_minor_unit (default 2).
 *
 * Canonical matching:
 *   1. Try extractIdentifiers(product.sku)   — many comic stores put ISBN in SKU
 *   2. Try extractIdentifiers(barcode attr)   — attributes named "isbn", "barcode", "ean"
 *   3. Fall through to matchCanonical with isbn13/ean from above; UNMATCHED if none
 *
 * Rate limiting: 2 s between pages; exponential back-off on 429/5xx.
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

// ── WooCommerce Store API shapes ──────────────────────────────────────────────

interface WCPrices {
  price               : string   // minor-unit integer string, e.g. "1299"
  currency_code       : string   // e.g. "USD"
  currency_minor_unit : number   // typically 2
}

interface WCImage {
  id  : number
  src : string
  alt : string
}

interface WCAttributeTerm {
  id   : number
  name : string
  slug : string
}

interface WCAttribute {
  id       : number
  name     : string
  taxonomy : string
  terms    : WCAttributeTerm[]
}

interface WCProduct {
  id          : number
  name        : string
  slug        : string
  permalink   : string
  sku         : string
  /** "instock" | "outofstock" | "onbackorder" */
  stock_status: string
  is_in_stock : boolean
  prices      : WCPrices
  images      : WCImage[]
  /** Product attributes — may include ISBN, barcode, EAN */
  attributes  : WCAttribute[]
}

/** The Store API wraps items in { items, total, total_pages } on WC ≥ 7.6 */
interface WCStorePage {
  items?       : WCProduct[]
  total?       : number
  total_pages? : number
}

// ── sync_config contract ──────────────────────────────────────────────────────

interface WCSyncConfig {
  prev_missing_skus? : string[]
  disabled_reason?   : string
  disabled_at?       : string
  [key: string]      : unknown
}

// ── Normalized listing ────────────────────────────────────────────────────────

export interface NormalizedListing extends BaseListing {
  rawData: WCProduct
}

// ── Constants ─────────────────────────────────────────────────────────────────

const USER_AGENT        = 'CatchComics/1.0 (+https://catchcomics.com/bot)'
const PAGE_SIZE         = 100
const MAX_PAGES         = 100
const BETWEEN_PAGE_MS   = 2_000
const MAX_FETCH_RETRIES = 3

/** Attribute names that commonly hold barcodes / ISBNs in WooCommerce stores */
const BARCODE_ATTR_NAMES = new Set([
  'isbn', 'isbn-13', 'isbn13', 'barcode', 'ean', 'ean-13', 'upc', 'gtin',
])

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
    console.warn(`[woocommerce] HTTP ${res.status} — attempt ${attempt + 1}/${retries + 1}, waiting ${waitMs}ms`)
    await sleep(waitMs)
    backoffMs = Math.min(backoffMs * 2, 60_000)
  }
  throw new Error('fetchWithRetry: unreachable')
}

// ── Identifier extraction (SKU + attributes) ──────────────────────────────────

/**
 * Extract ISBN-13 or EAN from a WooCommerce product.
 *
 * Priority:
 *   1. product.sku — many comic stores put the ISBN directly in the SKU field
 *   2. product.attributes — look for any attribute whose name/taxonomy matches
 *      a known barcode attribute name list (BARCODE_ATTR_NAMES)
 */
function extractWCIdentifiers(product: WCProduct): { isbn13: string | null; ean: string | null } {
  // 1. SKU
  const fromSku = extractIdentifiers(product.sku)
  if (fromSku.isbn13 || fromSku.ean) return fromSku

  // 2. Attributes
  for (const attr of product.attributes) {
    const attrName = attr.name.toLowerCase().replace(/\s+/g, '-')
    if (!BARCODE_ATTR_NAMES.has(attrName)) continue
    for (const term of attr.terms) {
      const fromAttr = extractIdentifiers(term.name)
      if (fromAttr.isbn13 || fromAttr.ean) return fromAttr
    }
  }

  return { isbn13: null, ean: null }
}

// ── Price parsing ─────────────────────────────────────────────────────────────

function parseWCPrice(prices: WCPrices): string {
  const minorUnits = parseInt(prices.price, 10)
  if (isNaN(minorUnits)) return '0.00'
  const divisor = Math.pow(10, prices.currency_minor_unit ?? 2)
  return (minorUnits / divisor).toFixed(prices.currency_minor_unit ?? 2)
}

// ── Stock status mapping ──────────────────────────────────────────────────────

function mapWCStockStatus(product: WCProduct): StockStatus {
  if (product.stock_status === 'onbackorder') return StockStatus.PREORDER
  if (product.is_in_stock || product.stock_status === 'instock') return StockStatus.IN_STOCK
  return StockStatus.OUT_OF_STOCK
}

// ── Normalization ─────────────────────────────────────────────────────────────

function normalizeProduct(
  product : WCProduct,
  currency: string,
): Omit<NormalizedListing, 'canonicalProductId' | 'matchMethod' | 'matchConfidence'> {
  const { isbn13, ean } = extractWCIdentifiers(product)
  const priceAmount     = parseWCPrice(product.prices)
  const priceCurrency   = product.prices.currency_code || currency
  const imageUrl        = product.images[0]?.src ?? null
  const retailerSku     = product.sku || String(product.id)

  return {
    retailerSku,
    retailerUrl    : product.permalink,
    title          : product.name,
    priceAmount,
    priceCurrency,
    stockStatus    : mapWCStockStatus(product),
    condition      : ListingCondition.NEW,
    conditionDetail: null,
    imageUrl,
    isbn13,
    ean,
    rawData        : product,
  }
}

// ── DB upsert (same pattern as other adapters) ────────────────────────────────

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
      lastSeenAt  : syncStart,
      stockStatus : listing.stockStatus,
      priceAmount : listing.priceAmount,
      title       : listing.title,
      imageUrl    : listing.imageUrl,
      ...({ isbn13: listing.isbn13 ?? null, ean: listing.ean ?? null } as object),
      rawData     : listing.rawData as unknown as Prisma.InputJsonValue,
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

export class WooCommerceAdapter {

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
    if (retailer.platform !== 'WOOCOMMERCE') {
      throw new Error(
        `WooCommerceAdapter.syncRetailer called for ${retailer.domain} ` +
        `(platform=${retailer.platform}). This adapter only supports WOOCOMMERCE retailers.`,
      )
    }

    const domain   = retailer.domain
    const currency = retailer.currency
    const syncCfg  = (retailer.syncConfig ?? {}) as WCSyncConfig
    const prevMissingSkus = new Set<string>(syncCfg.prev_missing_skus ?? [])
    const seenSkus = new Set<string>()

    console.log(`[woocommerce] starting sync for ${domain} (retailer ${retailerId})`)

    // ── Paginate /wp-json/wc/store/products ───────────────────────────────────
    paginationLoop:
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `https://${domain}/wp-json/wc/store/products?page=${page}&per_page=${PAGE_SIZE}`

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
        // No WooCommerce store or /wp-json/wc/store not installed
        console.warn(`[woocommerce] 404 on ${domain} — marking retailer inactive`)
        await prisma.retailer.update({
          where: { id: retailerId },
          data: {
            isActive  : false,
            syncConfig: { ...syncCfg, disabled_reason: 'Store API 404 — endpoint removed or WooCommerce not installed', disabled_at: new Date().toISOString() } as unknown as Prisma.InputJsonValue,
          },
        })
        errors.push({ type: 'fetch', message: '404 — retailer marked inactive', context: url })
        break paginationLoop
      }

      if (res.status === 401 || res.status === 403) {
        errors.push({ type: 'fetch', message: `${res.status} — Store API access denied on ${domain}`, context: url })
        break paginationLoop
      }

      if (!res.ok) {
        errors.push({ type: 'fetch', message: `HTTP ${res.status} ${res.statusText}`, context: url })
        break paginationLoop
      }

      // ── Parse — handle both wrapped { items } and raw array ────────────────
      const body = await res.json() as WCStorePage | WCProduct[]
      let products: WCProduct[]

      if (Array.isArray(body)) {
        products = body
      } else if (Array.isArray(body.items)) {
        products = body.items
      } else {
        // Unexpected shape — stop pagination
        errors.push({ type: 'fetch', message: 'Unexpected response shape — not an array or { items }', context: url })
        break paginationLoop
      }

      if (products.length === 0) break paginationLoop

      pagesFetched++
      productsFetched += products.length
      console.log(`[woocommerce] page ${page}: ${products.length} products`)

      // ── Normalize + match + upsert ─────────────────────────────────────────
      for (const product of products) {
        let pre: Omit<NormalizedListing, 'canonicalProductId' | 'matchMethod' | 'matchConfidence'>
        try {
          pre = normalizeProduct(product, currency)
        } catch (err) {
          errors.push({ type: 'normalize', message: err instanceof Error ? err.message : String(err), context: String(product.id) })
          continue
        }

        let matchData: Pick<NormalizedListing, 'canonicalProductId' | 'matchMethod' | 'matchConfidence'>
        try {
          matchData = await matchCanonical(pre.isbn13, pre.ean, pre.title, '[woocommerce]')
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

      // ── Respect total_pages hint if available ──────────────────────────────
      const wrapped = body as WCStorePage
      if (wrapped.total_pages && page >= wrapped.total_pages) break paginationLoop

      if (page < MAX_PAGES) await sleep(BETWEEN_PAGE_MS)
    }

    // ── Two-consecutive-syncs OUT_OF_STOCK rule ───────────────────────────────
    try {
      const allDbListings = await prisma.retailerListing.findMany({
        where : { retailerId },
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
        console.log(`[woocommerce] marked ${toMarkOos.length} listings OUT_OF_STOCK`)
      }
      await prisma.retailer.update({
        where: { id: retailerId },
        data: {
          lastSyncedAt: syncStart,
          syncConfig: {
            ...syncCfg,
            prev_missing_skus: Array.from(currentMissingSkus),
          } as unknown as Prisma.InputJsonValue,
        },
      })
    } catch (err) {
      errors.push({ type: 'db', message: `post-sync cleanup failed: ${err instanceof Error ? err.message : err}` })
    }

    const durationMs = Date.now() - startedAt
    console.log(
      `[woocommerce] sync complete for ${domain}: ` +
      `${pagesFetched} pages, ${productsFetched} products, ` +
      `${listingsCreated} created, ${listingsUpdated} updated, ` +
      `${priceChanges} price changes, ${errors.length} errors — ${durationMs}ms`,
    )
    return { retailerId, domain, pagesFetched, productsFetched, listingsCreated, listingsUpdated, priceChanges, errors, durationMs }
  }
}
