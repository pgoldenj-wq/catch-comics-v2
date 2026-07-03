/**
 * Query A — Canonical product search via Postgres FTS + pg_trgm.
 *
 * Searches `canonical_products` by title, series_name, isbn_13, and publisher
 * using websearch_to_tsquery (phrase-aware FTS) plus pg_trgm similarity for
 * typo tolerance. Hydrates each result with up to 5 in-stock offers.
 *
 * Returns at most 80 canonical products. Scoring/ranking is done in score.ts.
 */

import { prisma } from '@/lib/prisma'
import type { SearchQuery, CanonicalSearchResult, SearchOffer } from './types'

// Raw row returned by the $queryRaw FTS query
interface FtsRow {
  id:              string
  title:           string
  series_name:     string | null
  publisher:       string | null
  format:          string
  isbn_13:         string | null
  cover_image_url: string | null
  comicvine_id:    string | null
  canonical_slug:  string
  volume_number:   number | null
  release_date:    Date | null
  ts_rank:         number
  trgm_sim:        number
}

interface ListingRow {
  id:             string
  canonical_product_id: string
  retailer_id:    string
  retailer_name:  string
  retailer_url:   string
  price_amount:   string   // Decimal comes back as string from raw query
  price_currency: string
  stock_status:   string
  condition:      string
  trust_score:    number
  last_seen_at:   Date
  total_offers:   number  // full in-stock offer count for the product (window COUNT)
}

export async function queryCanonical(
  sq: SearchQuery
): Promise<CanonicalSearchResult[]> {
  const q = sq.q.trim()
  if (!q) return []

  // ISBN exact lookup — bypass FTS entirely
  const isbnClean = q.replace(/[\s\-]/g, '')
  const isIsbn13  = /^\d{13}$/.test(isbnClean)
  const isIsbn10  = /^\d{9}[\dXx]$/.test(isbnClean)

  let productRows: FtsRow[]

  if (isIsbn13 || isIsbn10) {
    if (isIsbn13) {
      productRows = await prisma.$queryRaw<FtsRow[]>`
        SELECT
          id, title, series_name, publisher, format::text,
          isbn_13, cover_image_url, comicvine_id, canonical_slug, volume_number, release_date,
          1.0::float4 AS ts_rank, 1.0::float4 AS trgm_sim
        FROM canonical_products
        WHERE deleted_at IS NULL AND isbn_13 = ${isbnClean}
        LIMIT 10
      `
    } else {
      productRows = await prisma.$queryRaw<FtsRow[]>`
        SELECT
          id, title, series_name, publisher, format::text,
          isbn_13, cover_image_url, comicvine_id, canonical_slug, volume_number, release_date,
          1.0::float4 AS ts_rank, 1.0::float4 AS trgm_sim
        FROM canonical_products
        WHERE deleted_at IS NULL AND isbn_10 = ${isbnClean}
        LIMIT 10
      `
    }
  } else {
    // FTS + trgm combined — use ts_rank for ordering, trgm_sim as secondary signal
    productRows = await prisma.$queryRaw<FtsRow[]>`
      SELECT
        id, title, series_name, publisher, format::text,
        isbn_13, cover_image_url, comicvine_id, canonical_slug, volume_number, release_date,
        ts_rank(
          to_tsvector('english', coalesce(title,'') || ' ' || coalesce(series_name,'') || ' ' || coalesce(publisher,'')),
          websearch_to_tsquery('english', ${q})
        )::float4 AS ts_rank,
        greatest(
          similarity(title, ${q}),
          coalesce(similarity(series_name, ${q}), 0)
        )::float4 AS trgm_sim
      FROM canonical_products
      WHERE
        -- Exclude soft-deleted rows (cleanup pollution must not resurface in search).
        -- NB: the OR group below MUST stay parenthesised — without the parens,
        -- "deleted_at IS NULL AND A OR B OR C" binds as "(NULL AND A) OR B OR C"
        -- and leaks deleted rows that match B or C.
        deleted_at IS NULL
        -- trgm threshold raised from 0.15 → 0.30 to reduce false positives on short queries.
        -- 0.15 matched almost any title sharing 2 trigrams (e.g. "Saga" → unrelated results);
        -- 0.30 requires meaningful trigram overlap while keeping good recall for 6+ char queries.
        AND (
          to_tsvector('english', coalesce(title,'') || ' ' || coalesce(series_name,'') || ' ' || coalesce(publisher,''))
            @@ websearch_to_tsquery('english', ${q})
          OR similarity(title, ${q}) > 0.30
          OR coalesce(similarity(series_name, ${q}), 0) > 0.30
        )
      ORDER BY ts_rank DESC, trgm_sim DESC
      -- Recall headroom: large series (e.g. Saga + 58 single issues) can crowd
      -- Volume 1 out of a 40-row cut, so it never reaches the relevance scorer.
      -- 80 keeps the full series in-set; composite scoring then sorts it.
      LIMIT 80
    `
  }

  if (productRows.length === 0) return []

  const productIds = productRows.map(r => r.id)

  // Hydrate offers — up to 5 IN_STOCK listings per product, cheapest first.
  // ROW_NUMBER caps to 5 rows per product *in the database* so a popular volume
  // with dozens of active listings transfers 5 rows, not all of them. COUNT(*)
  // OVER the same partition rides the true full offer count along on each row,
  // preserving the totalOffers semantics without a second round-trip.
  const listingRows = await prisma.$queryRaw<ListingRow[]>`
    WITH ranked AS (
      SELECT
        rl.id,
        rl.canonical_product_id,
        rl.retailer_id,
        ret.name AS retailer_name,
        rl.retailer_url,
        rl.price_amount,
        rl.price_currency,
        rl.stock_status,
        rl.condition,
        ret.trust_score,
        rl.last_seen_at,
        ROW_NUMBER() OVER (PARTITION BY rl.canonical_product_id ORDER BY rl.price_amount ASC) AS rn,
        COUNT(*)     OVER (PARTITION BY rl.canonical_product_id)                              AS total_offers
      FROM retailer_listings rl
      JOIN retailers ret ON ret.id = rl.retailer_id
      WHERE
        rl.canonical_product_id = ANY(${productIds}::uuid[])
        AND rl.stock_status IN ('IN_STOCK', 'LOW_STOCK', 'PREORDER')
        AND rl.deleted_at IS NULL
        AND ret.is_active = true
    )
    SELECT
      id,
      canonical_product_id,
      retailer_id,
      retailer_name,
      retailer_url,
      price_amount::text,
      price_currency,
      stock_status::text,
      condition::text,
      trust_score,
      last_seen_at,
      total_offers::int
    FROM ranked
    WHERE rn <= 5
    ORDER BY canonical_product_id, rn
  `

  // Group offers by canonical product id. The DB already capped each product to
  // its 5 cheapest in-stock listings (rn <= 5) and attached the full count via
  // total_offers, so we just collect rows and read the count off any of them.
  const offersByProduct = new Map<string, SearchOffer[]>()
  const countsByProduct = new Map<string, number>()

  for (const row of listingRows) {
    const pid = row.canonical_product_id
    const list = offersByProduct.get(pid) ?? []

    countsByProduct.set(pid, row.total_offers)

    list.push({
      listingId:    row.id,
      retailerId:   row.retailer_id,
      retailerName: row.retailer_name,
      retailerUrl:  row.retailer_url,
      priceAmount:  parseFloat(row.price_amount),
      currency:     row.price_currency,
      stockStatus:  row.stock_status,
      condition:    row.condition,
      trustScore:   row.trust_score,
      lastSeenAt:   row.last_seen_at.toISOString(),
    })
    offersByProduct.set(pid, list)
  }

  return productRows.map(r => ({
    type:          'canonical' as const,
    id:            r.id,
    title:         r.title,
    seriesName:    r.series_name,
    publisher:     r.publisher,
    format:        r.format,
    isbn13:        r.isbn_13,
    coverImageUrl: r.cover_image_url,
    comicvineId:   r.comicvine_id,
    canonicalSlug: r.canonical_slug,
    volumeNumber:  r.volume_number,
    releaseDate:   r.release_date ? r.release_date.toISOString().slice(0, 10) : null,
    offers:        offersByProduct.get(r.id) ?? [],
    totalOffers:   countsByProduct.get(r.id) ?? 0,
    // Raw score passed through — composite scoring in score.ts uses ts_rank + trgm_sim
    score:         r.ts_rank * 0.7 + r.trgm_sim * 0.3,
  }))
}
