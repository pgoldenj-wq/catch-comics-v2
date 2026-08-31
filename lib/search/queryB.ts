/**
 * Query B — Unmatched retailer listing search.
 *
 * Searches `retailer_listings` WHERE canonical_product_id IS NULL using FTS
 * on the title field. These are products ingested from retailers but not yet
 * matched to a canonical product. Shown as "Other listings" in the UI.
 *
 * Non-comic filter: General book retailers (WoB, Bookshop) feed cookbooks,
 * Latin texts, etc. into retailer_listings. isLikelyComic() removes those
 * before they hit the UI — a sample showed ~97% pollution otherwise.
 *
 * Cap: 20 results (post-filter).
 */

import { prisma } from '@/lib/prisma'
import type { SearchQuery, UnmatchedListing } from './types'
import { isLikelyComic } from './isLikelyComic'
import { listingMatchesQuery } from './listingRelevance'
import { MIN_TRUSTED_PRICE, isTrustedPrice } from '@/lib/listings/trustedPrice'

interface UnmatchedRow {
  id:             string
  title:          string
  retailer_id:    string
  retailer_name:  string
  retailer_url:   string
  price_amount:   string
  price_currency: string
  condition:      string
  stock_status:   string
  image_url:      string | null
  last_seen_at:   Date
}

export async function queryUnmatched(
  sq: SearchQuery
): Promise<UnmatchedListing[]> {
  const q = sq.q.trim()
  if (!q) return []

  // Over-fetch (60 rows) because isLikelyComic() typically removes the bulk
  // of WoB-style pollution. The post-filter slice caps at 20.
  const rows = await prisma.$queryRaw<UnmatchedRow[]>`
    SELECT
      rl.id,
      rl.title,
      rl.retailer_id,
      ret.name AS retailer_name,
      rl.retailer_url,
      rl.price_amount::text,
      rl.price_currency,
      rl.condition::text,
      rl.stock_status::text,
      rl.image_url,
      rl.last_seen_at
    FROM retailer_listings rl
    JOIN retailers ret ON ret.id = rl.retailer_id
    WHERE
      rl.canonical_product_id IS NULL
      AND rl.deleted_at IS NULL
      AND ret.is_active = true
      -- A £0.00 stub is missing data, not a free comic. 25,816 of the 26,591
      -- live unmatched listings are in that state; none may reach a shopper.
      AND rl.price_amount >= ${MIN_TRUSTED_PRICE}
      AND (
        to_tsvector('english', rl.title) @@ websearch_to_tsquery('english', ${q})
        OR similarity(rl.title, ${q}) > 0.2
      )
    ORDER BY
      ts_rank(to_tsvector('english', rl.title), websearch_to_tsquery('english', ${q})) DESC
    LIMIT 60
  `

  return rows
    // Trigram similarity said these LOOK alike. Relevance asks whether the
    // listing is about what was searched for, which is a different question and
    // the one that matters: it is what removes "Sewing for Absolute Beginners"
    // from a search for "absolute batman".
    .filter(r => listingMatchesQuery(r.title, q))
    .filter(r => isLikelyComic(r.title))
    .filter(r => isTrustedPrice(r.price_amount))
    .slice(0, 20)
    .map(r => ({
      type:         'unmatched' as const,
      id:           r.id,
      title:        r.title,
      retailerId:   r.retailer_id,
      retailerName: r.retailer_name,
      retailerUrl:  r.retailer_url,
      priceAmount:  parseFloat(r.price_amount),
      currency:     r.price_currency,
      condition:    r.condition,
      stockStatus:  r.stock_status,
      imageUrl:     r.image_url,
      lastSeenAt:   r.last_seen_at.toISOString(),
    }))
}
