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

// Temporary env-var presence check — visible directly in the API response.
// Remove once credentials are confirmed working in production.
const ENV_DEBUG = {
  hasClientId:     !!process.env.EBAY_CLIENT_ID,
  hasClientSecret: !!process.env.EBAY_CLIENT_SECRET,
  hasMarketplaceUK: !!process.env.EBAY_MARKETPLACE_ID_UK,
  hasMarketplaceUS: !!process.env.EBAY_MARKETPLACE_ID_US,
  nodeEnv:          process.env.NODE_ENV ?? 'unknown',
}

export async function GET(request: NextRequest) {
  console.log('[/api/prices] env debug:', ENV_DEBUG)
  const { searchParams } = request.nextUrl
  const query  = (searchParams.get('q')      || '').trim()
  const region = (searchParams.get('region') || 'uk').toLowerCase()

  if (!query) {
    return NextResponse.json({ error: 'No query provided', _env: ENV_DEBUG }, { status: 400 })
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
    return NextResponse.json({
      query,
      region,
      listings: Array.isArray(cached.listings) ? cached.listings : [],
    })
  }

  // ── Live fetch ─────────────────────────────────────────────────────────────
  try {
    const listings = await searchListings(query, marketplace, 20)
    // Sort cheapest first — matches "Best deal" UX on the comic detail page
    const sorted = [...listings].sort((a, b) => a.price.value - b.price.value)

    const body = {
      query,
      region,
      listings: sorted,
    }
    pricesCache.set(cacheKey, body)
    console.log(`[/api/prices] returned ${sorted.length} listings for "${query}" (${region})`)
    return NextResponse.json(body)

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Full error detail logged server-side (visible in Vercel Functions logs)
    console.error('[/api/prices] eBay error:', message)
    return NextResponse.json(
      { error: message, listings: [], count: 0, _env: ENV_DEBUG },
      { status: 502 }
    )
  }
}
