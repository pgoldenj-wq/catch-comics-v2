import { NextRequest, NextResponse } from 'next/server'
import { searchListings, type Marketplace } from '@/lib/ebay'
import { pricesCache } from '@/lib/cache'

/**
 * GET /api/prices?q={query}&region={uk|us}
 *
 * Live eBay Buy Browse API integration. Fetches item summaries for the given
 * query, sorts by price ascending, and caches the result for 1h per
 * (region, query) pair.
 *
 * Sandbox vs production is auto-detected from the EBAY_APP_ID prefix.
 */

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const query  = (searchParams.get('q')      || '').trim()
  const region = (searchParams.get('region') || 'uk').toLowerCase()

  if (!query) {
    return NextResponse.json({ error: 'No query provided' }, { status: 400 })
  }
  if (region !== 'uk' && region !== 'us') {
    return NextResponse.json({ error: 'Invalid region (must be uk or us)' }, { status: 400 })
  }

  const marketplace: Marketplace = region === 'uk'
    ? ((process.env.EBAY_MARKETPLACE_ID_UK as Marketplace) || 'EBAY_GB')
    : ((process.env.EBAY_MARKETPLACE_ID_US as Marketplace) || 'EBAY_US')

  // ── Cache check ────────────────────────────────────────────────────────────
  const cacheKey = `prices:${region}:${query.toLowerCase()}`
  const cached   = pricesCache.get(cacheKey)
  if (cached) {
    console.log(`[/api/prices] cache hit for "${query}" (${region})`)
    return NextResponse.json(cached)
  }

  // ── Live fetch ─────────────────────────────────────────────────────────────
  try {
    const listings = await searchListings(query, marketplace, 20)
    // Sort cheapest first — matches "Best deal" UX on the comic detail page
    const sorted = [...listings].sort((a, b) => a.price.value - b.price.value)

    const body = {
      query,
      region,
      marketplace,
      source:   'ebay',
      count:    sorted.length,
      listings: sorted,
    }
    pricesCache.set(cacheKey, body)
    console.log(`[/api/prices] returned ${sorted.length} listings for "${query}" (${region})`)
    return NextResponse.json(body)

  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error('[/api/prices] eBay error:', message)
    return NextResponse.json(
      { error: 'Failed to fetch listings.', detail: message, listings: [], count: 0 },
      { status: 502 }
    )
  }
}
