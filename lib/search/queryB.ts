/**
 * Query B — Unmatched retailer listing search.
 *
 * Searches `retailer_listings` WHERE canonical_product_id IS NULL using FTS
 * on the title field. These are products ingested from retailers but not yet
 * matched to a canonical product. Shown as "Other listings" in the UI.
 *
 * Cap: 20 results.
 */

import { prisma } from '@/lib/prisma'
import type { SearchQuery, UnmatchedListing } from './types'

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
      AND (
        to_tsvector('english', rl.title) @@ websearch_to_tsquery('english', ${q})
        OR similarity(rl.title, ${q}) > 0.2
      )
    ORDER BY
      ts_rank(to_tsvector('english', rl.title), websearch_to_tsquery('english', ${q})) DESC
    LIMIT 20
  `

  return rows.map(r => ({
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
