/**
 * Wordery affiliate adapter for Catch Comics.
 *
 * Platform type: DYNAMIC_LINK
 *   Listings are generated from the known ISBN path:
 *     https://wordery.com/{isbn13}
 *   Wordery redirects bare-ISBN paths to their canonical product page, so no
 *   title slug or internal product ID is required.
 *
 *   Affiliate attribution is applied at click time by /go/[id] via wrapAffiliateUrl()
 *   using affiliateNetwork='awin' and affiliateId='9111' (Wordery's Awin merchant ID).
 *
 *   Final click URL:
 *     https://www.awin1.com/cread.php?awinmid=9111&awinaffid=2888331&clickref=cc-{id}&ued={encodedUrl}
 *   where ued = https://wordery.com/{isbn13}
 *
 * Pricing:
 *   Wordery has no public API. All listings are created as stubs (stockStatus=UNKNOWN,
 *   priceAmount=£0.00) and excluded from the price-comparison table until a pricing
 *   source is available (Awin feed, periodic extraction, or manual entry).
 *
 * Coverage:
 *   Wordery carries 10M+ titles including broad UK comics, GN and manga coverage.
 *   Estimated 85–95% of our mainstream ISBN-registered canonicals.
 *
 * Env vars:
 *   AWIN_PUBLISHER_ID — set globally; used by wrapAffiliateUrl() for all Awin links.
 *                       No Wordery-specific env vars needed.
 *
 * Trust score: 80 (established UK bookseller, reliable fulfillment, Awin-verified).
 */

import { prisma }    from '@/lib/prisma'
import { Prisma, ListingCondition, MatchMethod, StockStatus } from '@prisma/client'

// Wordery's Awin merchant ID — not a secret, safe to hardcode.
// Publisher ID (AWIN_PUBLISHER_ID) is read from env by wrapAffiliateUrl().
const WORDERY_AWIN_MID = '9111'
const TRUST_SCORE      = 80

// ── URL generation ────────────────────────────────────────────────────────────

/**
 * Generate a Wordery product URL from an ISBN-13.
 * Wordery resolves bare ISBNs as the sole path segment, redirecting to the
 * canonical product page. No title slug required.
 */
export function generateWorderyUrl(isbn13: string): string {
  return `https://wordery.com/${isbn13}`
}

// ── Retailer record management ────────────────────────────────────────────────

/**
 * Get-or-create the Wordery retailer row.
 * Also patches pre-existing records missing affiliateNetwork.
 */
export async function ensureWorderyRetailer(): Promise<string> {
  const existing = await prisma.retailer.findUnique({ where: { domain: 'wordery.com' } })

  if (existing) {
    if (existing.affiliateNetwork !== 'awin') {
      await prisma.retailer.update({
        where: { id: existing.id },
        data: {
          platform        : 'DYNAMIC_LINK' as unknown as import('@prisma/client').RetailerPlatform,
          affiliateNetwork: 'awin',
          affiliateId     : WORDERY_AWIN_MID,
        },
      })
      console.log(`[wordery] patched retailer → DYNAMIC_LINK + affiliateNetwork=awin (mid=${WORDERY_AWIN_MID})`)
    }
    return existing.id
  }

  const created = await prisma.retailer.create({
    data: {
      name            : 'Wordery',
      domain          : 'wordery.com',
      platform        : 'DYNAMIC_LINK' as unknown as import('@prisma/client').RetailerPlatform,
      countryCode     : 'GB',
      currency        : 'GBP',
      isActive        : true,
      trustScore      : TRUST_SCORE,
      affiliateNetwork: 'awin',
      affiliateId     : WORDERY_AWIN_MID,
      syncConfig      : {},
    },
  })
  console.log(`[wordery] created retailer record (${created.id})`)
  return created.id
}

// ── DB upsert ─────────────────────────────────────────────────────────────────

/**
 * Upsert a Wordery dynamic-link stub for the given ISBN.
 *
 * All stubs have priceAmount=0.00 / stockStatus=UNKNOWN and are excluded
 * from the product page price-comparison table (priceAmount > 0 filter in
 * getProduct()). The /go/[id] affiliate redirect still works correctly.
 */
async function upsertWorderyListing(
  retailerId        : string,
  canonicalProductId: string,
  isbn13            : string,
  title             : string,
  syncAt            : Date,
): Promise<'created' | 'updated'> {
  const retailerUrl = generateWorderyUrl(isbn13)

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
        priceAmount    : '0.00',
        priceCurrency  : 'GBP',
        stockStatus    : StockStatus.UNKNOWN,
        condition      : ListingCondition.NEW,
        conditionDetail: null,
        imageUrl       : null,
        isbn13,
        rawData        : {} as Prisma.InputJsonValue,
        canonicalProductId,
        matchMethod    : MatchMethod.ISBN,
        matchConfidence: 90,
        firstSeenAt    : syncAt,
        lastSeenAt     : syncAt,
      },
    })
    return 'created'
  }

  // Touch lastSeenAt and ensure URL is current; don't downgrade a priced listing
  await prisma.retailerListing.update({
    where: { id: existing.id },
    data : { lastSeenAt: syncAt, retailerUrl, deletedAt: null },
  })
  return 'updated'
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface WorderyBackfillResult {
  processed : number
  created   : number
  updated   : number
  errors    : number
}

/**
 * Backfill Wordery dynamic-link stubs for all canonical products with an
 * isbn13 that do not already have a Wordery listing.
 *
 * Called by scripts/backfill-wordery-listings.ts.
 * Also suitable for use in a future Inngest job if pricing becomes available.
 */
export async function backfillWorderyListings(
  batchSize = 2000,
): Promise<WorderyBackfillResult> {
  const syncAt   = new Date()
  const stats: WorderyBackfillResult = { processed: 0, created: 0, updated: 0, errors: 0 }

  const retailerId = await ensureWorderyRetailer()

  const products = await prisma.$queryRaw<Array<{ id: string; isbn13: string; title: string }>>`
    SELECT cp.id, cp.isbn_13 AS isbn13, cp.title
    FROM   canonical_products cp
    WHERE  cp.isbn_13  IS NOT NULL
      AND  cp.deleted_at IS NULL
      AND  NOT EXISTS (
        SELECT 1
        FROM   retailer_listings rl
        JOIN   retailers r ON r.id = rl.retailer_id
        WHERE  rl.canonical_product_id = cp.id
          AND  r.domain = 'wordery.com'
          AND  rl.deleted_at IS NULL
      )
    ORDER  BY cp.created_at DESC
    LIMIT  ${batchSize}
  `

  for (const product of products) {
    stats.processed++
    try {
      const outcome = await upsertWorderyListing(
        retailerId, product.id, product.isbn13, product.title, syncAt,
      )
      if (outcome === 'created') stats.created++
      else                       stats.updated++
    } catch (err) {
      console.error(`[wordery] upsert failed for ${product.isbn13}:`, err)
      stats.errors++
    }

    // Yield every 200 rows to avoid connection pool saturation
    if (stats.processed % 200 === 0) {
      await new Promise(r => setTimeout(r, 25))
    }
  }

  return stats
}
