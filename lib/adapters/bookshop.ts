/**
 * Bookshop.org affiliate adapter for Catch Comics.
 *
 * Supports both the US (bookshop.org) and UK (uk.bookshop.org) stores.
 * Each market is represented by a separate retailer record so prices and
 * currencies remain distinct.
 *
 * API:
 *   ISBN lookup: GET https://api.bookshop.org/books/{isbn13}?api_key={KEY}
 *   UK variant:  GET https://api.bookshop.org/books/{isbn13}?api_key={KEY}&country=uk
 *
 * The `url` field in the response already contains Bookshop.org's own affiliate
 * attribution — do NOT modify it.  Set retailer_url directly from this field.
 *
 * Env vars:
 *   BOOKSHOP_API_KEY     — required for US lookups
 *   BOOKSHOP_UK_API_KEY  — optional; enables UK listings (can be same key)
 *
 * Trust score: 85 (ethical independent-bookshop affiliate, reliable data).
 */

import { prisma }    from '@/lib/prisma'
import { Prisma, ListingCondition, MatchMethod, StockStatus } from '@prisma/client'

// ── Bookshop API response shape ───────────────────────────────────────────────

export interface BookshopBook {
  isbn13       : string
  title        : string
  author       : string
  /** Current selling price in the market's currency */
  price        : number
  /** Recommended retail price */
  list_price   : number
  cover_image  : string
  description  : string
  /** Affiliate URL — already tagged; never modify */
  url          : string
}

// ── Market configuration ──────────────────────────────────────────────────────

interface MarketConfig {
  market       : 'us' | 'uk'
  retailerName : string
  /** Bare domain used as the unique retailer identifier in our DB */
  domain       : string
  currency     : string
  countryCode  : string
  apiKey       : string | undefined
  /** Query-string param to scope the request to a specific country */
  countryParam : string | null
}

const MARKETS: MarketConfig[] = [
  {
    market      : 'us',
    retailerName: 'Bookshop.org (US)',
    domain      : 'bookshop.org',
    currency    : 'USD',
    countryCode : 'US',
    apiKey      : process.env.BOOKSHOP_API_KEY,
    countryParam: null,
  },
  {
    market      : 'uk',
    retailerName: 'Bookshop.org (UK)',
    domain      : 'uk.bookshop.org',
    currency    : 'GBP',
    countryCode : 'GB',
    apiKey      : process.env.BOOKSHOP_UK_API_KEY ?? process.env.BOOKSHOP_API_KEY,
    countryParam: 'uk',
  },
]

const USER_AGENT  = 'CatchComics/1.0 (+https://catchcomics.com/bot)'
const TRUST_SCORE = 85

// ── Retailer record management ────────────────────────────────────────────────

/**
 * Get-or-create a retailer row for the given Bookshop.org market.
 * Safe to call on every lookup — upserts on domain conflict.
 */
async function ensureRetailer(cfg: MarketConfig): Promise<string> {
  const existing = await prisma.retailer.findUnique({ where: { domain: cfg.domain } })
  if (existing) return existing.id

  const created = await prisma.retailer.create({
    data: {
      name        : cfg.retailerName,
      domain      : cfg.domain,
      platform    : 'EXTERNAL_API' as unknown as import('@prisma/client').RetailerPlatform,
      countryCode : cfg.countryCode,
      currency    : cfg.currency,
      isActive    : true,
      trustScore  : TRUST_SCORE,
      syncConfig  : {},
    },
  })
  console.log(`[bookshop] created retailer record for ${cfg.domain} (${created.id})`)
  return created.id
}

// ── API fetch ─────────────────────────────────────────────────────────────────

async function fetchBookshopIsbn(isbn13: string, cfg: MarketConfig): Promise<BookshopBook | null> {
  if (!cfg.apiKey) return null  // market not configured

  const params = new URLSearchParams({ api_key: cfg.apiKey })
  if (cfg.countryParam) params.set('country', cfg.countryParam)

  const url = `https://api.bookshop.org/books/${isbn13}?${params.toString()}`

  let res: Response
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal : AbortSignal.timeout(10_000),
    })
  } catch (err) {
    console.warn(`[bookshop] fetch failed for ${isbn13} (${cfg.market}):`, err)
    return null
  }

  if (res.status === 404) return null  // ISBN not in Bookshop catalog

  if (!res.ok) {
    console.warn(`[bookshop] HTTP ${res.status} for ${isbn13} (${cfg.market})`)
    return null
  }

  try {
    return await res.json() as BookshopBook
  } catch {
    return null
  }
}

// ── DB upsert ─────────────────────────────────────────────────────────────────

async function upsertBookshopListing(
  retailerId        : string,
  canonicalProductId: string,
  book              : BookshopBook,
  currency          : string,
  syncAt            : Date,
): Promise<'created' | 'updated' | 'price_changed'> {
  const priceAmount = book.price.toFixed(2)

  const existing = await prisma.retailerListing.findUnique({
    where: { retailerId_retailerSku: { retailerId, retailerSku: book.isbn13 } },
  })

  if (!existing) {
    await prisma.retailerListing.create({
      data: {
        retailerId,
        retailerSku       : book.isbn13,
        retailerUrl       : book.url,   // affiliate-tagged URL from API — do not modify
        title             : book.title,
        priceAmount,
        priceCurrency     : currency,
        stockStatus       : StockStatus.IN_STOCK,
        condition         : ListingCondition.NEW,
        conditionDetail   : null,
        imageUrl          : book.cover_image || null,
        rawData           : book as unknown as Prisma.InputJsonValue,
        canonicalProductId,
        matchMethod       : MatchMethod.ISBN,
        matchConfidence   : 95,
        firstSeenAt       : syncAt,
        lastSeenAt        : syncAt,
        priceHistory: {
          create: {
            priceAmount,
            priceCurrency: currency,
            stockStatus  : StockStatus.IN_STOCK,
            recordedAt   : syncAt,
          },
        },
      },
    })
    return 'created'
  }

  const priceChanged = !existing.priceAmount.equals(new Prisma.Decimal(priceAmount))

  await prisma.retailerListing.update({
    where: { id: existing.id },
    data: {
      lastSeenAt : syncAt,
      stockStatus: StockStatus.IN_STOCK,
      priceAmount,
      title      : book.title,
      imageUrl   : book.cover_image || null,
      rawData    : book as unknown as Prisma.InputJsonValue,
      retailerUrl: book.url,
      deletedAt  : null,   // un-delete if it was soft-deleted
      ...(priceChanged ? { lastPriceChangeAt: syncAt } : {}),
    },
  })

  if (priceChanged) {
    await prisma.priceHistory.create({
      data: {
        retailerListingId: existing.id,
        priceAmount,
        priceCurrency    : currency,
        stockStatus      : StockStatus.IN_STOCK,
        recordedAt       : syncAt,
      },
    })
    return 'price_changed'
  }

  return 'updated'
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface BookshopLookupResult {
  market       : 'us' | 'uk'
  found        : boolean
  outcome      : 'created' | 'updated' | 'price_changed' | 'not_found' | 'skipped' | 'error'
  priceAmount ?: string
  currency    ?: string
}

/**
 * Look up an ISBN on Bookshop.org and upsert the listing(s) into the DB.
 *
 * @param isbn13            The ISBN-13 to look up.
 * @param canonicalProductId The canonical_products.id to link the listing to.
 * @param markets           Which markets to query. Default: all configured markets.
 */
export async function lookupByIsbn(
  isbn13            : string,
  canonicalProductId: string,
  markets           : Array<'us' | 'uk'> = ['us', 'uk'],
): Promise<BookshopLookupResult[]> {
  const syncAt  = new Date()
  const results : BookshopLookupResult[] = []

  for (const marketKey of markets) {
    const cfg = MARKETS.find(m => m.market === marketKey)!

    if (!cfg.apiKey) {
      results.push({ market: marketKey, found: false, outcome: 'skipped' })
      continue
    }

    try {
      const book = await fetchBookshopIsbn(isbn13, cfg)
      if (!book) {
        results.push({ market: marketKey, found: false, outcome: 'not_found' })
        continue
      }

      const retailerId = await ensureRetailer(cfg)
      const outcome    = await upsertBookshopListing(retailerId, canonicalProductId, book, cfg.currency, syncAt)

      results.push({
        market     : marketKey,
        found      : true,
        outcome,
        priceAmount: book.price.toFixed(2),
        currency   : cfg.currency,
      })
      console.log(`[bookshop] ${outcome} listing for ${isbn13} (${cfg.market}) @ ${cfg.currency} ${book.price}`)
    } catch (err) {
      console.error(`[bookshop] error for ${isbn13} (${marketKey}):`, err)
      results.push({ market: marketKey, found: false, outcome: 'error' })
    }
  }

  return results
}

/**
 * Backfill / refresh Bookshop.org listings for canonical products that either
 * have no Bookshop listing or whose listing is older than `staleAfterDays`.
 *
 * Called by the daily Inngest bookshop-refresh job.
 */
export async function refreshStaleBookshopListings(
  batchSize      = 100,
  staleAfterDays = 7,
): Promise<{ processed: number; found: number; notFound: number; errors: number }> {
  const staleThreshold = new Date(Date.now() - staleAfterDays * 86_400_000)
  const stats = { processed: 0, found: 0, notFound: 0, errors: 0 }

  // Find canonical products with isbn13 that have no Bookshop listing,
  // or whose Bookshop listing hasn't been seen recently.
  const bookshopDomains = MARKETS.map(m => m.domain)

  const products = await prisma.$queryRaw<Array<{ id: string; isbn13: string }>>`
    SELECT cp.id, cp.isbn_13 AS isbn13
    FROM   canonical_products cp
    WHERE  cp.isbn_13 IS NOT NULL
      AND  NOT EXISTS (
        SELECT 1
        FROM   retailer_listings rl
        JOIN   retailers r ON r.id = rl.retailer_id
        WHERE  rl.canonical_product_id = cp.id
          AND  r.domain = ANY(${bookshopDomains}::text[])
          AND  rl.last_seen_at > ${staleThreshold}
          AND  rl.deleted_at IS NULL
      )
    ORDER  BY cp.created_at DESC
    LIMIT  ${batchSize}
  `

  for (const product of products) {
    stats.processed++
    try {
      const results = await lookupByIsbn(product.isbn13, product.id)
      const anyFound = results.some(r => r.found)
      if (anyFound) stats.found++
      else          stats.notFound++
    } catch {
      stats.errors++
    }
  }

  return stats
}
