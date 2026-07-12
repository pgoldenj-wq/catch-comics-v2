import { NextRequest, NextResponse } from 'next/server'
import { searchListings, type Marketplace } from '@/lib/ebay'
import { pricesCache } from '@/lib/cache'
import { enforceRateLimit } from '@/lib/security/rateLimit'

/**
 * GET /api/price-hint?isbn={isbn13|isbn10}&region={uk|us}
 *
 * Returns the lowest eBay price for one specific edition, keyed by ISBN.
 *
 * LB-3 (2026-07-12): the previous version accepted a free-text `q` title and
 * searched eBay by keyword, which produced wrong-product price anchors on the
 * search page (e.g. an unreleased ~£30 hardcover showing "From £5.95" — a
 * single issue's price). A wrong low price is worse than no hint, so this
 * route now refuses to guess: no valid ISBN → null price, no eBay call.
 *
 * Rate-limited (LB-6): the search page fires up to ~20 staggered calls per
 * results page per user; 120/min per IP leaves generous headroom for humans
 * while stopping scripted floods from burning the eBay daily quota.
 *
 * Response: { lowestPrice: number | null, currency: string | null }
 */

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, 'price-hint', 120)
  if (limited) return limited

  const { searchParams } = request.nextUrl
  const isbnRaw = (searchParams.get('isbn') || '').trim().replace(/[-\s]/g, '')
  const region  = (searchParams.get('region') || 'uk').toLowerCase()

  // ISBN-10 or ISBN-13 only (last char of ISBN-10 may be X). Anything else —
  // including the legacy `q` title param — gets an honest empty hint.
  if (!/^(\d{13}|\d{9}[\dXx])$/.test(isbnRaw)) {
    return NextResponse.json({ lowestPrice: null, currency: null })
  }

  const cacheKey = `hint2:${region}:${isbnRaw}`
  const cached = pricesCache.get(cacheKey) as { lowestPrice: number | null; currency: string | null } | null
  if (cached) {
    return NextResponse.json(cached)
  }

  try {
    const marketplace: Marketplace = region === 'uk'
      ? ((process.env.EBAY_MARKETPLACE_ID_UK as Marketplace) || 'EBAY_GB')
      : ((process.env.EBAY_MARKETPLACE_ID_US as Marketplace) || 'EBAY_US')

    // ISBN keyword search inside the Comics & Graphic Novels category — the
    // same precision path /api/ebay uses for the product-page offers table.
    const listings = await searchListings(isbnRaw, marketplace, 20)
    const sorted   = [...listings].sort((a, b) => a.price.value - b.price.value)
    const best     = sorted[0] ?? null

    const result: { lowestPrice: number | null; currency: string | null } = best
      ? { lowestPrice: best.price.value, currency: best.price.currency }
      : { lowestPrice: null, currency: null }

    pricesCache.set(cacheKey, result)
    return NextResponse.json(result)

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[/api/price-hint] error for isbn:', isbnRaw, '—', message)
    return NextResponse.json({ lowestPrice: null, currency: null })
  }
}
