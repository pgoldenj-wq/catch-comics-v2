/**
 * GET /api/ebay?isbn=ISBN13&title=TITLE
 *
 * Product-page eBay marketplace lookup.
 *
 * Strategy:
 *   1. ISBN search first (if isbn param provided) — highly precise, avoids
 *      false positives from ambiguous comic titles.
 *   2. Title search fallback — for items without ISBNs (single issues, etc.)
 *      Uses title + format keyword to narrow results.
 *
 * Filtering:
 *   - eBay category 259104 (Comics & Graphic Novels) — enforced in searchListings()
 *   - FCBD and non-comic terms — filtered in lib/ebay.ts
 *   - "Lot of" / bundle listings — filtered here (too noisy for single-item comparison)
 *   - Broken/parts/incomplete listings — filtered here
 *
 * Caching: 1 hour per (isbn|title) key — eBay prices are volatile but cache
 *   prevents hammering the API during heavy traffic on popular product pages.
 *
 * Marketplace: EBAY_GB only (UK prices, GBP).
 *
 * Security: server-only (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET never exposed to client).
 */

import { NextRequest, NextResponse } from 'next/server'
import { searchListings, EbayListing } from '@/lib/ebay'
import { TTLCache } from '@/lib/cache'

// Module-level 1-hour cache — shared across warm serverless instances
const ebayProductCache = new TTLCache<EbayListing[]>(60 * 60 * 1000)

// Phrases that indicate a listing is not a clean single-item sale
const LOT_BUNDLE_PATTERNS = [
  /\blot of\b/i,
  /\bjob lot\b/i,
  /\bbundle of\b/i,
  /\bset of\b/i,
  /\bcollection of\b/i,
  /\bx\d+\b/i,            // "x5 comics", "x10 issues"
  /\b\d+ comics\b/i,
  /\b\d+ books\b/i,
  /\bparts only\b/i,
  /\bfor parts\b/i,
  /\bincomplete\b/i,
  /\bno cover\b/i,
  /\bmissing pages\b/i,
]

function isLotOrBundle(title: string): boolean {
  return LOT_BUNDLE_PATTERNS.some(rx => rx.test(title))
}

function filterListings(listings: EbayListing[]): EbayListing[] {
  return listings.filter(l => !isLotOrBundle(l.title))
}

export const runtime = 'nodejs' // Buffer required for OAuth Basic auth in lib/ebay.ts

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const isbn  = (searchParams.get('isbn')  || '').trim()
  const title = (searchParams.get('title') || '').trim()

  if (!isbn && !title) {
    return NextResponse.json({ error: 'isbn or title required' }, { status: 400 })
  }

  // Cache key: prefer ISBN (deterministic), fall back to normalised title
  const cacheKey = isbn
    ? `ebay:isbn:${isbn}`
    : `ebay:title:${title.toLowerCase().replace(/\s+/g, ' ')}`

  const cached = ebayProductCache.get(cacheKey)
  if (cached) {
    return NextResponse.json({ listings: cached, source: 'cache' })
  }

  try {
    let listings: EbayListing[] = []

    if (isbn) {
      // ISBN search — most precise. eBay sellers frequently include ISBNs in titles
      // or use the ISBN field. Category 259104 + ISBN query gives very clean results.
      listings = await searchListings(isbn, 'EBAY_GB', 20)

      // If ISBN returns < 3 results, supplement with title search
      // (some listings don't include the ISBN in their title)
      if (listings.length < 3 && title) {
        const titleResults = await searchListings(title, 'EBAY_GB', 20)
        // Merge, dedup by itemId
        const seen = new Set(listings.map(l => l.itemId))
        for (const l of titleResults) {
          if (!seen.has(l.itemId)) {
            listings.push(l)
            seen.add(l.itemId)
          }
        }
      }
    } else {
      // No ISBN — title-only search
      listings = await searchListings(title, 'EBAY_GB', 20)
    }

    // Apply additional product-page filters
    listings = filterListings(listings)

    // Sort by price ascending, cap at 8 (enough for the section without overwhelming)
    listings = listings
      .sort((a, b) => a.price.value - b.price.value)
      .slice(0, 8)

    ebayProductCache.set(cacheKey, listings)

    return NextResponse.json({ listings, source: 'live' })
  } catch (err) {
    // Graceful degradation — product page must never fail because eBay is down
    console.error('[/api/ebay] eBay API error:', err)
    return NextResponse.json({ listings: [], source: 'error', error: String(err) })
  }
}
