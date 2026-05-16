/**
 * Bookshop.org affiliate adapter for Catch Comics.
 *
 * Supports both the US (bookshop.org) and UK (uk.bookshop.org) stores.
 * Each market is represented by a separate retailer record so prices and
 * currencies remain distinct.
 *
 * Platform type: DYNAMIC_LINK
 *   Listings are generated from the known ISBN deep-link URL pattern:
 *     https://uk.bookshop.org/book/{isbn13}
 *   This resolves via a 308 redirect to the canonical product page slug.
 *   Affiliate attribution is applied at click time by /go/[id] via wrapAffiliateUrl()
 *   using the retailer's affiliateNetwork='awin' and affiliateId='62675' (Bookshop UK
 *   Awin merchant ID).
 *
 *   Final click URL:
 *     https://www.awin1.com/cread.php?awinmid=62675&awinaffid=2888331&ued={encodedUrl}
 *   where ued = https://uk.bookshop.org/book/{isbn13}
 *
 * API enrichment (optional):
 *   GET https://api.bookshop.org/books/{isbn13}?api_key={KEY}
 *   UK: GET https://api.bookshop.org/books/{isbn13}?api_key={KEY}&country=uk
 *
 *   When BOOKSHOP_API_KEY is set, the API is called and real prices are stored.
 *   When no API key, dynamic link stubs are created (stockStatus=UNKNOWN, price=0.00).
 *   Stubs are filtered from the product page display but provide valid affiliate links.
 *   The daily bookshop-refresh Inngest job promotes stubs to real listings once the
 *   API key is configured.
 *
 * Env vars:
 *   AWIN_PUBLISHER_ID    — set globally; used by wrapAffiliateUrl() for all Awin links
 *   BOOKSHOP_API_KEY     — optional; enables real price data from Bookshop API
 *   BOOKSHOP_UK_API_KEY  — optional UK-specific override (falls back to BOOKSHOP_API_KEY)
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
  /** Product URL — may contain an internal affiliate token; normalised before storage */
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
  /** Query-string param to scope the API request to a specific country */
  countryParam : string | null
}

// Awin merchant ID for Bookshop.org UK — not a secret, safe to hardcode.
// Publisher ID (2888331) is read from AWIN_PUBLISHER_ID by wrapAffiliateUrl().
const BOOKSHOP_UK_AWIN_MID = '62675'

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

// ── URL helpers ───────────────────────────────────────────────────────────────

/**
 * Generate a bare Bookshop.org product URL from an ISBN-13.
 *
 * Bookshop.org resolves ISBNs via the /book/{isbn13} path, which issues a
 * 308 redirect to the canonical product page slug. Note: /p/books/{isbn13}
 * returns 404 and must NOT be used.
 *
 * Affiliate attribution is NOT included here — it is added at click time by
 * wrapAffiliateUrl() in /go/[id] via the Awin case, producing:
 *   https://www.awin1.com/cread.php?awinmid=62675&awinaffid=2888331&ued={encodedUrl}
 */
function generateBookshopUrl(isbn13: string, cfg: MarketConfig): string {
  const base = cfg.market === 'uk' ? 'https://uk.bookshop.org' : 'https://bookshop.org'
  return `${base}/book/${isbn13}`
}

/**
 * Strip any existing affiliate prefix from a Bookshop.org URL.
 *
 * The Bookshop.org API may return URLs pre-tagged with the API caller's
 * affiliate token:
 *   https://uk.bookshop.org/a/{token}/p/books/{slug}/{id}
 * → https://uk.bookshop.org/p/books/{slug}/{id}
 *
 * We always store the bare URL and apply our own affiliate token at click
 * time via wrapAffiliateUrl(), ensuring we earn the commission.
 */
function normalizeBookshopUrl(rawUrl: string): string {
  try {
    const u     = new URL(rawUrl)
    const match = u.pathname.match(/^\/a\/[^/]+(\/.+)$/)
    if (match) u.pathname = match[1]!
    return u.origin + u.pathname + u.search + u.hash
  } catch {
    return rawUrl
  }
}

// ── Retailer record management ────────────────────────────────────────────────

/**
 * Get-or-create a retailer row for the given Bookshop.org market.
 * Safe to call on every lookup — upserts on domain conflict.
 *
 * Also patches pre-existing records that were created before DYNAMIC_LINK /
 * affiliateNetwork support was added, ensuring the /go/[id] redirect always
 * applies our affiliate token.
 */
async function ensureRetailer(cfg: MarketConfig): Promise<string> {
  // UK market routes through Awin (merchant 62675).
  // US market has no Awin relationship — no affiliate wrapping.
  const affiliateNetwork = cfg.market === 'uk' ? 'awin'            : null
  const affiliateId      = cfg.market === 'uk' ? BOOKSHOP_UK_AWIN_MID : null

  const existing = await prisma.retailer.findUnique({ where: { domain: cfg.domain } })

  if (existing) {
    // Patch records created before the Awin routing was established.
    // Condition covers: wrong network ('bookshop'), or missing network (null) on UK records.
    const needsPatch = cfg.market === 'uk' && existing.affiliateNetwork !== 'awin'
    if (needsPatch) {
      await prisma.retailer.update({
        where: { id: existing.id },
        data: {
          platform        : 'DYNAMIC_LINK' as unknown as import('@prisma/client').RetailerPlatform,
          affiliateNetwork: 'awin',
          affiliateId     : BOOKSHOP_UK_AWIN_MID,
        },
      })
      console.log(`[bookshop] patched retailer ${cfg.domain} → DYNAMIC_LINK + affiliateNetwork=awin (mid=${BOOKSHOP_UK_AWIN_MID})`)
    }
    return existing.id
  }

  const created = await prisma.retailer.create({
    data: {
      name            : cfg.retailerName,
      domain          : cfg.domain,
      platform        : 'DYNAMIC_LINK' as unknown as import('@prisma/client').RetailerPlatform,
      countryCode     : cfg.countryCode,
      currency        : cfg.currency,
      isActive        : true,
      trustScore      : TRUST_SCORE,
      affiliateNetwork,
      affiliateId,
      syncConfig      : {},
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

/**
 * Upsert a Bookshop.org listing for the given ISBN.
 *
 * @param book  API response data. Pass null for a dynamic-link stub (no API call).
 *
 * When book is null, the listing is created with stockStatus=UNKNOWN and
 * priceAmount=0.00. These stubs are excluded from product page display by the
 * `priceAmount > 0` filter in getProduct(), but the /go/[id] affiliate redirect
 * still works correctly once the affiliate ID is configured.
 *
 * When a subsequent API call resolves the stub (book !== null), the listing is
 * promoted: real price, IN_STOCK status, and a price history entry are written.
 */
async function upsertBookshopListing(
  retailerId        : string,
  canonicalProductId: string,
  isbn13            : string,
  cfg               : MarketConfig,
  book              : BookshopBook | null,
  syncAt            : Date,
): Promise<'created' | 'updated' | 'price_changed'> {
  // URL: normalise API URL (strips any pre-existing affiliate prefix) or generate from ISBN
  const retailerUrl  = book ? normalizeBookshopUrl(book.url) : generateBookshopUrl(isbn13, cfg)
  const priceAmount  = book ? book.price.toFixed(2) : '0.00'
  const stockStatus  = book ? StockStatus.IN_STOCK   : StockStatus.UNKNOWN
  const title        = book?.title ?? isbn13
  const imageUrl     = book?.cover_image            || null

  const existing = await prisma.retailerListing.findUnique({
    where: { retailerId_retailerSku: { retailerId, retailerSku: isbn13 } },
  })

  if (!existing) {
    await prisma.retailerListing.create({
      data: {
        retailerId,
        retailerSku    : isbn13,
        retailerUrl,
        title,
        priceAmount,
        priceCurrency  : cfg.currency,
        stockStatus,
        condition      : ListingCondition.NEW,
        conditionDetail: null,
        imageUrl,
        isbn13,
        rawData        : (book ?? {}) as unknown as Prisma.InputJsonValue,
        canonicalProductId,
        matchMethod    : MatchMethod.ISBN,
        matchConfidence: 95,
        firstSeenAt    : syncAt,
        lastSeenAt     : syncAt,
        // Only write price history when we have a real price
        ...(book ? {
          priceHistory: {
            create: {
              priceAmount,
              priceCurrency: cfg.currency,
              stockStatus  : StockStatus.IN_STOCK,
              recordedAt   : syncAt,
            },
          },
        } : {}),
      },
    })
    return 'created'
  }

  // Stub update: just touch lastSeenAt + URL; don't overwrite a real price with 0.00
  if (!book) {
    if (existing.stockStatus === StockStatus.UNKNOWN) {
      await prisma.retailerListing.update({
        where: { id: existing.id },
        data : { lastSeenAt: syncAt, retailerUrl, deletedAt: null },
      })
    }
    // If the listing already has a real price, leave it untouched
    return 'updated'
  }

  // Full update from API data
  const priceChanged = !existing.priceAmount.equals(new Prisma.Decimal(priceAmount))

  await prisma.retailerListing.update({
    where: { id: existing.id },
    data: {
      lastSeenAt : syncAt,
      stockStatus: StockStatus.IN_STOCK,
      priceAmount,
      title,
      imageUrl,
      rawData    : book as unknown as Prisma.InputJsonValue,
      retailerUrl,
      isbn13,
      deletedAt  : null,
      ...(priceChanged ? { lastPriceChangeAt: syncAt } : {}),
    },
  })

  if (priceChanged) {
    await prisma.priceHistory.create({
      data: {
        retailerListingId: existing.id,
        priceAmount,
        priceCurrency    : cfg.currency,
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
 * Behaviour:
 *   1. If BOOKSHOP_[UK_]API_KEY is set — calls the API to get real price data.
 *   2. If no API key — creates a dynamic link stub (UNKNOWN stock, £0.00).
 *      The stub provides a valid affiliate redirect via /go/[id] but is
 *      excluded from the product page's price comparison table.
 *
 * @param isbn13              The ISBN-13 to look up.
 * @param canonicalProductId  The canonical_products.id to link the listing to.
 * @param markets             Which markets to query. Default: all configured markets.
 * @param allowStubs          If true (default), create dynamic link stubs when no API
 *                            key is configured. Pass false to skip markets with no key.
 */
export async function lookupByIsbn(
  isbn13            : string,
  canonicalProductId: string,
  markets           : Array<'us' | 'uk'> = ['us', 'uk'],
  allowStubs        = true,
): Promise<BookshopLookupResult[]> {
  const syncAt  = new Date()
  const results : BookshopLookupResult[] = []

  for (const marketKey of markets) {
    const cfg = MARKETS.find(m => m.market === marketKey)!

    try {
      // Attempt API fetch (returns null if no key or 404)
      const book = cfg.apiKey ? await fetchBookshopIsbn(isbn13, cfg) : null

      // No API key + stubs not wanted → skip this market
      if (!book && !cfg.apiKey && !allowStubs) {
        results.push({ market: marketKey, found: false, outcome: 'skipped' })
        continue
      }

      // API returned 404 → book not in catalog; only create stub if we have an affiliate ID
      if (!book && cfg.apiKey && !allowStubs) {
        results.push({ market: marketKey, found: false, outcome: 'not_found' })
        continue
      }

      const retailerId = await ensureRetailer(cfg)
      const outcome    = await upsertBookshopListing(
        retailerId, canonicalProductId, isbn13, cfg, book, syncAt,
      )

      results.push({
        market     : marketKey,
        found      : book !== null,
        outcome,
        priceAmount: book?.price.toFixed(2),
        currency   : cfg.currency,
      })

      if (book) {
        console.log(`[bookshop] ${outcome} listing for ${isbn13} (${cfg.market}) @ ${cfg.currency} ${book.price}`)
      } else {
        console.log(`[bookshop] ${outcome} dynamic stub for ${isbn13} (${cfg.market})`)
      }
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

  const bookshopDomains = MARKETS.map(m => m.domain)

  const products = await prisma.$queryRaw<Array<{ id: string; isbn13: string }>>`
    SELECT cp.id, cp.isbn_13 AS isbn13
    FROM   canonical_products cp
    WHERE  cp.isbn_13 IS NOT NULL
      AND  cp.deleted_at IS NULL
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
