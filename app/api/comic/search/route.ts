/**
 * GET /api/comic/search?q=<title>
 *
 * Searches Comic Vine volumes by title and returns the best-matching volume ID.
 * Used by CVIssuesGrid as a fallback when comicvineId is not yet set on a product.
 *
 * Matching strategy:
 *   1. Exact name match (case-insensitive)
 *   2. Highest issue count among results (likely the main run)
 *
 * Results cached 24 h via the standard cvGet/cvSet infrastructure (KV → TTLCache).
 */

import { NextRequest, NextResponse } from 'next/server'
import { cvFetch, cvGet, cvSet } from '@/lib/comicvine'

interface CVVolume {
  id: number
  name: string
  count_of_issues: number
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim()
  if (!q) {
    return NextResponse.json({ error: 'Missing q param' }, { status: 400 })
  }

  const cacheKey = `cv-search-vol:${q.toLowerCase()}`

  // ── Cache check (KV → TTLCache fallback) ─────────────────────────────────
  const cached = await cvGet<{ volumeId: string | null; name: string | null }>('search', cacheKey)
  if (cached !== null) {
    return NextResponse.json(cached)
  }

  const apiKey = process.env.COMIC_VINE_API_KEY
  if (!apiKey) {
    console.error('[/api/comic/search] COMIC_VINE_API_KEY not set')
    return NextResponse.json({ volumeId: null, name: null })
  }

  const url =
    `https://comicvine.gamespot.com/api/search/` +
    `?api_key=${apiKey}&format=json` +
    `&query=${encodeURIComponent(q)}` +
    `&resources=volume` +
    `&field_list=id,name,count_of_issues` +
    `&limit=5`

  try {
    const res = await cvFetch(url)
    if (!res) {
      // Circuit open or 429 — return empty, do NOT cache (let it retry next time)
      return NextResponse.json({ volumeId: null, name: null })
    }

    const data = await res.json()
    const results: CVVolume[] = Array.isArray(data.results) ? data.results : []

    // Pick best match
    const normalised = q.toLowerCase()
    let best = results.find(r => r.name?.toLowerCase() === normalised)
    if (!best && results.length > 0) {
      best = [...results].sort(
        (a, b) => (b.count_of_issues ?? 0) - (a.count_of_issues ?? 0)
      )[0]
    }

    const result = {
      volumeId: best ? String(best.id) : null,
      name:     best?.name ?? null,
    }

    // Only cache definitive answers (even null — avoids hammering CV for unknown titles)
    await cvSet('search', cacheKey, result)
    return NextResponse.json(result)

  } catch (err) {
    console.error('[/api/comic/search] Unexpected error:', err)
    return NextResponse.json({ volumeId: null, name: null })
  }
}
