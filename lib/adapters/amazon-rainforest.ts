/**
 * Amazon on-demand price lookup via Rainforest API for Catch Comics.
 *
 * Design goals:
 *   - Only triggered from the product detail page for real user traffic
 *   - Only for canonical products with isbn_13
 *   - TTL cache: return a DB-cached listing if last_seen_at < 6 hours ago
 *   - Rate limit: max 10 Rainforest API calls per minute (in-memory sliding
 *     window — works for single-instance Vercel; swap for Redis on multi-instance)
 *   - Every API call is logged to api_usage_log for budget tracking
 *
 * Env vars:
 *   RAINFOREST_API_KEY — required; get from app.rainforestapi.com
 *
 * Retailer records:
 *   Created on first lookup if they don't exist.
 *   platform = EXTERNAL_API, trust_score = 90.
 *
 * Pricing reference: Rainforest charges ~$0.001 per request at standard tier.
 */

import { prisma }  from '@/lib/prisma'
import {
  Prisma,
  ListingCondition,
  MatchMethod,
  StockStatus,
} from '@prisma/client'

// ── Rainforest API response types ─────────────────────────────────────────────

interface RainforestPrice {
  value    : number
  currency : string
  symbol   : string
  raw      : string
}

interface RainforestBuyboxWinner {
  price?            : RainforestPrice
  is_prime          : boolean
  availability?     : { is_in_stock: boolean; raw: string }
  condition?        : { is_new: boolean; title: string }
}

interface RainforestProduct {
  title         : string
  asin          : string
  link          : string
  main_image?   : { link: string }
  buybox_winner?: RainforestBuyboxWinner
  price?        : RainforestPrice
  /** Some editions carry ISBN in the product attributes */
  specifications?: Array<{ name: string; value: string }>
}

interface RainforestResponse {
  request_info: { success: boolean; credits_used: number; credits_remaining: number }
  product?    : RainforestProduct
}

// ── Amazon market configuration ───────────────────────────────────────────────

export type AmazonDomain = 'amazon.co.uk' | 'amazon.com'

interface AmazonMarket {
  domain      : AmazonDomain
  retailerName: string
  /** Bare domain used as retailer.domain in our DB */
  dbDomain    : string
  currency    : string
  countryCode : string
}

const AMAZON_MARKETS: Record<AmazonDomain, AmazonMarket> = {
  'amazon.co.uk': {
    domain      : 'amazon.co.uk',
    retailerName: 'Amazon UK',
    dbDomain    : 'amazon.co.uk',
    currency    : 'GBP',
    countryCode : 'GB',
  },
  'amazon.com': {
    domain      : 'amazon.com',
    retailerName: 'Amazon US',
    dbDomain    : 'amazon.com',
    currency    : 'USD',
    countryCode : 'US',
  },
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TTL_HOURS          = 6
const TRUST_SCORE        = 90
const COST_PER_CALL_USD  = 0.001    // Rainforest standard tier estimate
const USER_AGENT         = 'CatchComics/1.0 (+https://catchcomics.com/bot)'

// ── Quota sentinel ────────────────────────────────────────────────────────────
// Thrown (not returned null) when Rainforest returns 402 Payment Required.
// Callers that want to hard-stop on quota exhaustion should catch this type.
// lookupByIsbn re-throws it so enrich-amazon-bulk.ts can detect and abort.

export class RainforestQuotaError extends Error {
  constructor() {
    super('Rainforest API returned 402 — credits exhausted or payment required. Check app.rainforestapi.com.')
    this.name = 'RainforestQuotaError'
  }
}

// ── In-memory rate limiter ────────────────────────────────────────────────────
// 10 calls per 60-second sliding window.
// NOTE: This is process-local. On multi-instance Vercel, each instance has its
// own counter. Replace the arrays below with Redis ZADD/ZCOUNT for a true global
// rate limit across instances. Example (ioredis):
//   await redis.zadd('rainforest:calls', Date.now(), uuid())
//   await redis.zremrangebyscore('rainforest:calls', '-inf', Date.now() - 60_000)
//   const count = await redis.zcard('rainforest:calls')

const RATE_LIMIT         = 10
const RATE_WINDOW_MS     = 60_000
const callLog: number[]  = []   // timestamps of recent calls

function canCallRainforest(): boolean {
  const now    = Date.now()
  const cutoff = now - RATE_WINDOW_MS
  // Evict expired entries
  while (callLog.length > 0 && callLog[0] < cutoff) callLog.shift()
  return callLog.length < RATE_LIMIT
}

function recordCall(): void {
  callLog.push(Date.now())
}

// ── Retailer management ───────────────────────────────────────────────────────

async function ensureAmazonRetailer(market: AmazonMarket): Promise<string> {
  const existing = await prisma.retailer.findUnique({ where: { domain: market.dbDomain } })
  if (existing) return existing.id

  const created = await prisma.retailer.create({
    data: {
      name       : market.retailerName,
      domain     : market.dbDomain,
      platform   : 'EXTERNAL_API' as unknown as import('@prisma/client').RetailerPlatform,
      countryCode: market.countryCode,
      currency   : market.currency,
      isActive   : true,
      trustScore : TRUST_SCORE,
      syncConfig : {},
    },
  })
  console.log(`[amazon] created retailer record for ${market.dbDomain} (${created.id})`)
  return created.id
}

// ── TTL cache check ───────────────────────────────────────────────────────────

async function findFreshListing(
  retailerId        : string,
  canonicalProductId: string,
): Promise<{ id: string; priceAmount: Prisma.Decimal; priceCurrency: string; retailerUrl: string } | null> {
  const threshold = new Date(Date.now() - TTL_HOURS * 3_600_000)
  return prisma.retailerListing.findFirst({
    where: {
      retailerId,
      canonicalProductId,
      deletedAt : null,
      lastSeenAt: { gt: threshold },
    },
    select: { id: true, priceAmount: true, priceCurrency: true, retailerUrl: true },
    orderBy: { lastSeenAt: 'desc' },
  })
}

// ── Usage logging ─────────────────────────────────────────────────────────────

async function logUsage(
  isbn13      : string,
  endpoint    : string,
  resultFound : boolean,
  latencyMs   : number,
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).apiUsageLog.create({
      data: {
        provider    : 'rainforest',
        endpoint    : endpoint.replace(/api_key=[^&]+/, 'api_key=REDACTED'),
        isbn13,
        resultFound,
        latencyMs,
        costEstimate: COST_PER_CALL_USD.toString(),
      },
    })
  } catch (err) {
    console.warn('[amazon] failed to write api_usage_log:', err)
  }
}

// ── Rainforest API fetch ──────────────────────────────────────────────────────

async function fetchRainforest(isbn13: string, amazonDomain: AmazonDomain): Promise<RainforestProduct | null> {
  const apiKey = process.env.RAINFOREST_API_KEY
  if (!apiKey) {
    console.warn('[amazon] RAINFOREST_API_KEY not set — skipping lookup')
    return null
  }

  if (!canCallRainforest()) {
    console.warn('[amazon] rate limit reached — skipping Rainforest call for', isbn13)
    return null
  }

  const params = new URLSearchParams({
    api_key      : apiKey,
    type         : 'product',
    amazon_domain: amazonDomain,
    gtin         : isbn13,
  })
  const url   = `https://api.rainforestapi.com/request?${params.toString()}`
  const start = Date.now()

  recordCall()
  let res: Response
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal : AbortSignal.timeout(15_000),
    })
  } catch (err) {
    await logUsage(isbn13, url, false, Date.now() - start)
    console.warn(`[amazon] fetch failed for ${isbn13}:`, err)
    return null
  }

  const latencyMs = Date.now() - start

  if (!res.ok) {
    await logUsage(isbn13, url, false, latencyMs)
    if (res.status === 402) {
      // 402 = credits exhausted / payment required — no point retrying any ISBN.
      // Throw a typed error so callers can hard-stop the run immediately.
      throw new RainforestQuotaError()
    }
    console.warn(`[amazon] HTTP ${res.status} for ${isbn13} on ${amazonDomain}`)
    return null
  }

  const body = await res.json() as RainforestResponse
  const found = Boolean(body.request_info?.success && body.product)
  await logUsage(isbn13, url, found, latencyMs)

  return found ? body.product! : null
}

// ── Result normalization ──────────────────────────────────────────────────────

function normalizeAmazonProduct(
  product : RainforestProduct,
  market  : AmazonMarket,
): { priceAmount: string; currency: string; stockStatus: StockStatus; retailerUrl: string; imageUrl: string | null } {
  // Prefer buybox winner price; fall back to product-level price
  const price = product.buybox_winner?.price ?? product.price
  const priceAmount = price ? price.value.toFixed(2) : '0.00'
  const currency    = price?.currency ?? market.currency

  const inStock = product.buybox_winner?.availability?.is_in_stock ?? true
  const stockStatus = inStock ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK

  return {
    priceAmount,
    currency,
    stockStatus,
    retailerUrl: product.link,
    imageUrl   : product.main_image?.link ?? null,
  }
}

// ── DB upsert ─────────────────────────────────────────────────────────────────

async function upsertAmazonListing(
  retailerId        : string,
  canonicalProductId: string,
  isbn13            : string,
  product           : RainforestProduct,
  market            : AmazonMarket,
): Promise<'created' | 'updated' | 'price_changed'> {
  const syncAt = new Date()
  const norm   = normalizeAmazonProduct(product, market)

  const existing = await prisma.retailerListing.findUnique({
    where: { retailerId_retailerSku: { retailerId, retailerSku: product.asin } },
  })

  if (!existing) {
    await prisma.retailerListing.create({
      data: {
        retailerId,
        retailerSku       : product.asin,
        retailerUrl       : norm.retailerUrl,
        title             : product.title,
        priceAmount       : norm.priceAmount,
        priceCurrency     : norm.currency,
        stockStatus       : norm.stockStatus,
        condition         : ListingCondition.NEW,
        conditionDetail   : null,
        imageUrl          : norm.imageUrl,
        rawData           : product as unknown as Prisma.InputJsonValue,
        canonicalProductId,
        matchMethod       : MatchMethod.ISBN,
        matchConfidence   : 95,
        firstSeenAt       : syncAt,
        lastSeenAt        : syncAt,
        priceHistory: {
          create: {
            priceAmount  : norm.priceAmount,
            priceCurrency: norm.currency,
            stockStatus  : norm.stockStatus,
            recordedAt   : syncAt,
          },
        },
      },
    })
    return 'created'
  }

  const priceChanged = !existing.priceAmount.equals(new Prisma.Decimal(norm.priceAmount))

  await prisma.retailerListing.update({
    where: { id: existing.id },
    data: {
      lastSeenAt       : syncAt,
      stockStatus      : norm.stockStatus,
      priceAmount      : norm.priceAmount,
      retailerUrl      : norm.retailerUrl,
      title            : product.title,
      imageUrl         : norm.imageUrl,
      rawData          : product as unknown as Prisma.InputJsonValue,
      deletedAt        : null,
      ...(priceChanged ? { lastPriceChangeAt: syncAt } : {}),
    },
  })

  if (priceChanged) {
    await prisma.priceHistory.create({
      data: {
        retailerListingId: existing.id,
        priceAmount      : norm.priceAmount,
        priceCurrency    : norm.currency,
        stockStatus      : norm.stockStatus,
        recordedAt       : syncAt,
      },
    })
    return 'price_changed'
  }

  return 'updated'
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface AmazonOffer {
  /** DB listing id */
  listingId   : string
  retailerName: string
  retailerUrl : string
  priceAmount : number
  currency    : string
  stockStatus : StockStatus
  imageUrl    : string | null
  /** true = served from DB cache, false = freshly fetched from Rainforest */
  fromCache   : boolean
}

/**
 * Look up an Amazon listing for a canonical product.
 *
 * Returns null when:
 *   - RAINFOREST_API_KEY is not set
 *   - Rate limit is exceeded
 *   - Rainforest returns no result
 *   - Any unhandled error (always gracefully degrades)
 *
 * @param isbn13             ISBN-13 to query
 * @param canonicalProductId Canonical product row to link the listing to
 * @param amazonDomain       Which Amazon marketplace to query
 */
export async function lookupByIsbn(
  isbn13            : string,
  canonicalProductId: string,
  amazonDomain      : AmazonDomain = 'amazon.co.uk',
): Promise<AmazonOffer | null> {
  const market     = AMAZON_MARKETS[amazonDomain]
  const retailerId = await ensureAmazonRetailer(market)

  // ── TTL cache check ────────────────────────────────────────────────────────
  const fresh = await findFreshListing(retailerId, canonicalProductId)
  if (fresh) {
    return {
      listingId   : fresh.id,
      retailerName: market.retailerName,
      retailerUrl : fresh.retailerUrl,
      priceAmount : Number(fresh.priceAmount),
      currency    : fresh.priceCurrency,
      stockStatus : StockStatus.IN_STOCK,
      imageUrl    : null,
      fromCache   : true,
    }
  }

  // ── Live Rainforest lookup ─────────────────────────────────────────────────
  try {
    const product = await fetchRainforest(isbn13, amazonDomain)
    if (!product) return null

    const outcome = await upsertAmazonListing(retailerId, canonicalProductId, isbn13, product, market)
    const norm    = normalizeAmazonProduct(product, market)

    // Fetch the inserted listing id for the return value
    const row = await prisma.retailerListing.findUnique({
      where : { retailerId_retailerSku: { retailerId, retailerSku: product.asin } },
      select: { id: true },
    })

    console.log(`[amazon] ${outcome} listing for ${isbn13} on ${amazonDomain} @ ${norm.currency} ${norm.priceAmount}`)

    return {
      listingId   : row?.id ?? '',
      retailerName: market.retailerName,
      retailerUrl : norm.retailerUrl,
      priceAmount : Number(norm.priceAmount),
      currency    : norm.currency,
      stockStatus : norm.stockStatus,
      imageUrl    : norm.imageUrl,
      fromCache   : false,
    }
  } catch (err) {
    if (err instanceof RainforestQuotaError) throw err  // propagate — caller should hard-stop
    console.error(`[amazon] unhandled error for ${isbn13}:`, err)
    return null
  }
}
