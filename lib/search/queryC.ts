/**
 * Query C — Live eBay search.
 *
 * Wraps lib/ebay.ts searchListings() with a 1500ms hard timeout.
 * After fetching, attempts to match each result against canonical products
 * via ISBN found in the title. Matched items are returned separately so the
 * orchestrator can merge them into canonicalResults. Unmatched items become
 * looseEbayResults (capped at 10).
 *
 * ISBN extraction: looks for 10/13-digit sequences in the title.
 */

import { searchListings } from '@/lib/ebay'
import { prisma } from '@/lib/prisma'
import type { SearchQuery, LooseEbayResult } from './types'
import type { EbayListing } from '@/lib/ebay'
import { isLikelyComic } from './isLikelyComic'

// Matched eBay listing tied back to a canonical product
export interface MatchedEbayListing {
  canonicalProductId: string
  listing: EbayListing
}

export interface QueryCResult {
  matched: MatchedEbayListing[]
  loose:   LooseEbayResult[]
}

function extractIsbn(title: string): string | null {
  const stripped = title.replace(/[\s\-]/g, '')
  const m13 = stripped.match(/\b(\d{13})\b/)
  if (m13) return m13[1]
  const m10 = stripped.match(/\b(\d{9}[\dXx])\b/i)
  if (m10) return m10[1].toUpperCase()
  return null
}

export async function queryEbay(sq: SearchQuery): Promise<QueryCResult> {
  const q          = sq.q.trim()
  const marketplace = sq.region === 'uk' ? 'EBAY_GB' : 'EBAY_US'

  if (!q) return { matched: [], loose: [] }

  // 1500ms timeout wrapping the eBay call
  let listings: EbayListing[] = []
  try {
    listings = await Promise.race([
      searchListings(q, marketplace, 20),
      new Promise<EbayListing[]>((_, reject) =>
        setTimeout(() => reject(new Error('eBay timeout')), 1500)
      ),
    ])
  } catch (err) {
    console.warn('[queryC] eBay call failed or timed out:', err instanceof Error ? err.message : err)
    return { matched: [], loose: [] }
  }

  if (listings.length === 0) return { matched: [], loose: [] }

  // Attempt ISBN matching for each listing
  const isbnMap = new Map<string, EbayListing[]>()  // isbn → listings
  const noIsbn:  EbayListing[] = []

  for (const listing of listings) {
    const isbn = extractIsbn(listing.title)
    if (isbn) {
      const arr = isbnMap.get(isbn) ?? []
      arr.push(listing)
      isbnMap.set(isbn, arr)
    } else {
      noIsbn.push(listing)
    }
  }

  // Look up ISBNs in canonical_products
  const matched: MatchedEbayListing[] = []
  const loose:   LooseEbayResult[]   = []

  if (isbnMap.size > 0) {
    const isbns = [...isbnMap.keys()]
    interface IsbnRow { id: string; isbn_13: string | null; isbn_10: string | null }
    const rows = await prisma.$queryRaw<IsbnRow[]>`
      SELECT id, isbn_13, isbn_10
      FROM canonical_products
      WHERE isbn_13 = ANY(${isbns}) OR isbn_10 = ANY(${isbns})
    `

    const isbnToProductId = new Map<string, string>()
    for (const row of rows) {
      if (row.isbn_13) isbnToProductId.set(row.isbn_13, row.id)
      if (row.isbn_10) isbnToProductId.set(row.isbn_10, row.id)
    }

    for (const [isbn, ebayListings] of isbnMap.entries()) {
      const productId = isbnToProductId.get(isbn)
      if (productId) {
        for (const l of ebayListings) {
          matched.push({ canonicalProductId: productId, listing: l })
        }
      } else {
        loose.push(...ebayListings.map(mapToLoose))
      }
    }
  }

  // Unmatched (no ISBN in title) become loose results; cap total loose at 10.
  // Filter out non-comic eBay results (random books that share a title token).
  // Matched results bypass the filter — they already tied back to a canonical product.
  const allLoose = [...loose, ...noIsbn.map(mapToLoose)]
    .filter(l => isLikelyComic(l.title))
  return {
    matched,
    loose: allLoose.slice(0, 10),
  }
}

function mapToLoose(l: EbayListing): LooseEbayResult {
  return {
    type:       'ebay',
    itemId:     l.itemId,
    title:      l.title,
    price:      l.price.value,
    currency:   l.price.currency,
    condition:  l.condition,
    imageUrl:   l.imageUrl,
    itemWebUrl: l.itemWebUrl,
    seller:     l.seller,
  }
}
