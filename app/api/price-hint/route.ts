import { NextRequest, NextResponse } from 'next/server'
import { searchListings, type Marketplace } from '@/lib/ebay'
import { pricesCache } from '@/lib/cache'

/**
 * GET /api/price-hint?q={query}&region={uk|us}
 *
 * Fetches the same 20 eBay listings as /api/prices and returns only the
 * lowest price for the search-results page. Side-effect: warms the full
 * prices cache so the detail page gets a cache hit and shows the same
 * cheapest price — eliminating the "From £X" mismatch.
 *
 * Response: { lowestPrice: number | null, currency: string | null }
 */

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const query  = (searchParams.get('q') || '').trim()
  const region = (searchParams.get('region') || 'uk').toLowerCase()

  if (!query) {
    return NextResponse.json({ lowestPrice: null, currency: null })
  }

  // Reuse the same pricesCache with a distinct key prefix
  const cacheKey = `hint:${region}:${query.toLowerCase()}`
  const cached = pricesCache.get(cacheKey) as { lowestPrice: number | null; currency: string | null } | null
  if (cached) {
    return NextResponse.json(cached)
  }

  try {
    // ── Check full prices cache first ────────────────────────────────────
    // If /api/prices has already fetched 20 listings for this query (e.g. the
    // user visited the detail page), reuse that data so the hint price is
    // guaranteed to match the cheapest listing shown on the detail page.
    const fullCacheKey = `prices:${region}:${query.toLowerCase()}`
    const fullCached = pricesCache.get(fullCacheKey) as
      | { listings?: Array<{ price: { value: number; currency: string } }> }
      | null
    if (fullCached?.listings?.length) {
      const sorted = [...fullCached.listings].sort((a, b) => a.price.value - b.price.value)
      const best   = sorted[0]
      const result = { lowestPrice: best.price.value, currency: best.price.currency }
      pricesCache.set(cacheKey, result)
      return NextResponse.json(result)
    }

    const marketplace: Marketplace = region === 'uk'
      ? ((process.env.EBAY_MARKETPLACE_ID_UK as Marketplace) || 'EBAY_GB')
      : ((process.env.EBAY_MARKETPLACE_ID_US as Marketplace) || 'EBAY_US')

    // Fetch the same 20 listings that /api/prices would fetch, then:
    //   1. Warm the full prices cache so the detail page gets a cache hit (no
    //      second eBay round-trip) and shows an identical cheapest price.
    //   2. Return the cheapest as the hint — guaranteed to match the detail page.
    const listings = await searchListings(query, marketplace, 20)
    const sorted   = [...listings].sort((a, b) => a.price.value - b.price.value)
    const best     = sorted[0] ?? null

    // Populate the full prices cache so /api/prices reuses this result
    if (sorted.length > 0) {
      pricesCache.set(fullCacheKey, { query, region, listings: sorted })
    }

    const result: { lowestPrice: number | null; currency: string | null } = best
      ? { lowestPrice: best.price.value, currency: best.price.currency }
      : { lowestPrice: null, currency: null }

    pricesCache.set(cacheKey, result)
    return NextResponse.json(result)

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[/api/price-hint] error for query:', query, '—', message)
    // Never return an error status here — callers treat non-null lowestPrice as success
    return NextResponse.json({ lowestPrice: null, currency: null })
  }
}
