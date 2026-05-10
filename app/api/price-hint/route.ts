import { NextRequest, NextResponse } from 'next/server'
import { searchListings, type Marketplace } from '@/lib/ebay'
import { pricesCache } from '@/lib/cache'

/**
 * GET /api/price-hint?q={query}&region={uk|us}&format={all|graphic-novel|single-issue|manga}
 *
 * Fetches eBay listings and returns only the lowest price matching the requested
 * format for the search-results page. Side-effect: warms the full prices cache.
 *
 * format param (optional, default 'all'):
 *   'all'           → cheapest of all listings
 *   'graphic-novel' → cheapest listing matching TPB/collected/volume keywords
 *   'single-issue'  → cheapest listing matching issue/#N keywords
 *   'manga'         → cheapest listing matching manga/tankobon keywords
 *
 * Response: { lowestPrice: number | null, currency: string | null }
 */

export const runtime = 'nodejs'

// ── Format keyword filter — mirrors PricingPanel client-side logic ────────────
function filterListingsByFormat(
  listings: Array<{ title: string; price: { value: number; currency: string } }>,
  format: string,
): Array<{ title: string; price: { value: number; currency: string } }> {
  if (format === 'all') return listings
  return listings.filter(l => {
    const t = l.title.toLowerCase()
    switch (format) {
      case 'single-issue':
        return /#\d/.test(t) || t.includes('issue') || t.includes('single')
      case 'graphic-novel':
        return (
          /\bvol(ume)?\b/.test(t) || t.includes('tpb') || t.includes('trade') ||
          t.includes('omnibus') || t.includes('hardcover') || t.includes('complete') ||
          t.includes('complet')
        )
      case 'manga':
        return t.includes('manga') || t.includes('tankobon') || t.includes(' vol.')
      default:
        return true
    }
  })
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const query  = (searchParams.get('q')      || '').trim()
  const region = (searchParams.get('region') || 'uk').toLowerCase()
  const format = (searchParams.get('format') || 'all').toLowerCase()

  if (!query) {
    return NextResponse.json({ lowestPrice: null, currency: null })
  }

  // Cache key includes format so each filter variant is stored separately
  const cacheKey = `hint:${region}:${format}:${query.toLowerCase()}`
  const cached = pricesCache.get(cacheKey) as { lowestPrice: number | null; currency: string | null } | null
  if (cached) {
    return NextResponse.json(cached)
  }

  try {
    // ── Check full prices cache first ────────────────────────────────────
    // If /api/prices has already fetched listings for this (query, region, format)
    // combo, reuse that data without hitting eBay again.
    const fullCacheKey = `prices:${region}:${format}:${query.toLowerCase()}`
    const fullCached = pricesCache.get(fullCacheKey) as
      | { listings?: Array<{ title: string; price: { value: number; currency: string } }> }
      | null
    if (fullCached?.listings?.length) {
      const filtered = filterListingsByFormat(fullCached.listings, format)
      const sorted   = [...(filtered.length ? filtered : fullCached.listings)]
        .sort((a, b) => a.price.value - b.price.value)
      const best   = sorted[0]
      const result = { lowestPrice: best.price.value, currency: best.price.currency }
      pricesCache.set(cacheKey, result)
      return NextResponse.json(result)
    }

    const marketplace: Marketplace = region === 'uk'
      ? ((process.env.EBAY_MARKETPLACE_ID_UK as Marketplace) || 'EBAY_GB')
      : ((process.env.EBAY_MARKETPLACE_ID_US as Marketplace) || 'EBAY_US')

    // Fetch more listings when a specific format is requested — larger pool
    // improves recall for format-specific items (e.g. TPBs aren't always cheapest)
    const limit = format !== 'all' ? 40 : 20
    const listings = await searchListings(query, marketplace, limit)
    const sorted   = [...listings].sort((a, b) => a.price.value - b.price.value)

    // Populate the full prices cache so /api/prices reuses this result
    if (sorted.length > 0) {
      pricesCache.set(fullCacheKey, { query, region, format, listings: sorted })
    }

    // Apply format filter to find the cheapest relevant listing
    const filtered = filterListingsByFormat(sorted, format)
    const best     = (filtered.length ? filtered : sorted)[0] ?? null

    const result: { lowestPrice: number | null; currency: string | null } = best
      ? { lowestPrice: best.price.value, currency: best.price.currency }
      : { lowestPrice: null, currency: null }

    pricesCache.set(cacheKey, result)
    return NextResponse.json(result)

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[/api/price-hint] error for query:', query, '—', message)
    return NextResponse.json({ lowestPrice: null, currency: null })
  }
}
