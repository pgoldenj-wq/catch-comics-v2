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
 * Sandbox vs production is auto-detected from the EBAY_CLIENT_ID prefix.
 */

// Force Node.js runtime — required for Buffer (OAuth base64 encoding) and for
// the in-memory token cache. Edge runtime does not have Buffer.
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const query  = (searchParams.get('q')      || '').trim()
  const region = (searchParams.get('region') || 'uk').toLowerCase()
  // format param: 'all' (default) | 'graphic-novel' | 'single-issue' | 'manga'
  // When a specific format is requested we fetch a larger pool (40 vs 20) so
  // the client-side keyword filter has enough candidates. E.g. for graphic-novel,
  // TPBs may not be the 20 cheapest — they appear further down the price list.
  const format = (searchParams.get('format') || 'all').toLowerCase()

  if (!query) {
    return NextResponse.json({ error: 'No query provided' }, { status: 400 })
  }
  if (region !== 'uk' && region !== 'us') {
    return NextResponse.json({ error: 'Invalid region (must be uk or us)' }, { status: 400 })
  }

  const marketplace: Marketplace = region === 'uk'
    ? ((process.env.EBAY_MARKETPLACE_ID_UK as Marketplace) || 'EBAY_GB')
    : ((process.env.EBAY_MARKETPLACE_ID_US as Marketplace) || 'EBAY_US')

  // ── Cache check — key includes format so each filter gets its own cache ────
  const cacheKey = `prices:${region}:${format}:${query.toLowerCase()}`
  const cached   = pricesCache.get(cacheKey)
  if (cached) {
    console.log(`[/api/prices] cache hit for "${query}" (${region}, ${format})`)
    return NextResponse.json({
      query,
      region,
      listings: Array.isArray(cached.listings) ? cached.listings : [],
    })
  }

  // ── Live fetch ─────────────────────────────────────────────────────────────
  try {
    // Larger pool for format-specific requests improves recall (TPBs, single
    // issues, etc. may not be the cheapest and won't appear in a 20-item set)
    const limit = format !== 'all' ? 40 : 20
    const listings = await searchListings(query, marketplace, limit)
    // Sort cheapest first — matches "Best deal" UX on the comic detail page
    const sorted = [...listings].sort((a, b) => a.price.value - b.price.value)

    const body = { query, region, format, listings: sorted }
    pricesCache.set(cacheKey, body)
    console.log(`[/api/prices] returned ${sorted.length} listings for "${query}" (${region}, ${format})`)
    return NextResponse.json(body)

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[/api/prices] eBay error:', message)
    return NextResponse.json(
      { error: message, listings: [], count: 0 },
      { status: 502 }
    )
  }
}
