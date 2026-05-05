import { NextRequest, NextResponse } from 'next/server'
import { searchListings, type Marketplace } from '@/lib/ebay'
import { pricesCache } from '@/lib/cache'

/**
 * GET /api/price-hint?q={query}&region={uk|us}
 *
 * Lightweight endpoint for the search results page.
 * Fetches only 5 eBay listings and returns the lowest price only.
 * Much cheaper/faster than the full /api/prices endpoint.
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
    const marketplace: Marketplace = region === 'uk'
      ? ((process.env.EBAY_MARKETPLACE_ID_UK as Marketplace) || 'EBAY_GB')
      : ((process.env.EBAY_MARKETPLACE_ID_US as Marketplace) || 'EBAY_US')

    // Fetch only 5 results — we just need the cheapest one
    const listings = await searchListings(query, marketplace, 5)
    const sorted   = [...listings].sort((a, b) => a.price.value - b.price.value)
    const best     = sorted[0] ?? null

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
