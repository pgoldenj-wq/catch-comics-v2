/**
 * GET /api/comic/search?q=<title>
 *
 * Searches Comic Vine volumes by title and returns the best-matching volume ID.
 * Used by the issue grid as a fallback when comicvineId is not yet set.
 *
 * The matching itself lives in lib/comicvine/title-match.ts, shared with the
 * self-heal write at PATCH /api/product/[slug]/comicvine-id. One
 * implementation means the id a caller can read here is produced by exactly
 * the code that decides what may be stored there — so reading this endpoint
 * first gains a caller nothing.
 *
 * Results cached 24 h via cvGet/cvSet (KV → TTLCache).
 */

import { NextRequest, NextResponse } from 'next/server'
import { enforceRateLimit } from '@/lib/security/rateLimit'
import { searchVolumeByTitle } from '@/lib/comicvine/title-match'

export async function GET(request: NextRequest) {
  // Comic Vine allows 200 requests/hour for the whole site, and a cache miss
  // here spends one of them.
  const limited = await enforceRateLimit(request, 'comic-search', 20)
  if (limited) return limited

  const q = request.nextUrl.searchParams.get('q')?.trim()
  if (!q) {
    return NextResponse.json({ error: 'Missing q param' }, { status: 400 })
  }

  return NextResponse.json(await searchVolumeByTitle(q))
}
