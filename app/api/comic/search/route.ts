/**
 * GET /api/comic/search?q=<title>
 *
 * Searches Comic Vine volumes by title and returns the best-matching volume ID.
 * Used by CVIssuesGrid as a fallback when comicvineId is not yet set on a product.
 *
 * Matching strategy:
 *   1. Exact name match (case-insensitive)
 *   2. Word-overlap similarity score ≥ 0.5 + highest issue count as tiebreaker
 *   3. No match returned if similarity is too low (prevents wrong ID self-healing)
 *
 * Results cached 24 h via the standard cvGet/cvSet infrastructure (KV → TTLCache).
 */

import { NextRequest, NextResponse } from 'next/server'
import { cvFetch, cvGet, cvSet } from '@/lib/comicvine'

interface CVVolume {
  id: number
  name: string
  count_of_issues: number
  start_year: string | null
  publisher: { name: string } | null
}

/**
 * Symmetric word-overlap similarity between two strings.
 * Returns a value in [0, 1]: fraction of query words that appear in candidate
 * multiplied by fraction of candidate words that appear in query (Jaccard-ish).
 * Strips common edition/format noise words before comparing.
 */
function titleSimilarity(query: string, candidate: string): number {
  const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'vol', 'volume',
    'edition', 'book', 'part', 'absolute', 'omnibus', 'deluxe', 'complete'])

  const tokenise = (s: string) =>
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !STOP.has(w))

  const qWords = new Set(tokenise(query))
  const cWords = new Set(tokenise(candidate))

  if (qWords.size === 0 || cWords.size === 0) return 0

  let hits = 0
  for (const w of qWords) if (cWords.has(w)) hits++

  // Precision: how many query words matched. Recall: how many candidate words matched.
  const precision = hits / qWords.size
  const recall    = hits / cWords.size

  // F1-style harmonic mean — penalises very short candidates (like "Batman") matching
  // a long specific query (like "Absolute Batman Volume 2 Abomination")
  if (precision + recall === 0) return 0
  return (2 * precision * recall) / (precision + recall)
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
    `&field_list=id,name,count_of_issues,start_year,publisher` +
    `&limit=10`

  try {
    const res = await cvFetch(url)
    if (!res) {
      // Circuit open or 429 — return empty, do NOT cache (let it retry next time)
      return NextResponse.json({ volumeId: null, name: null })
    }

    const data = await res.json()
    const results: CVVolume[] = Array.isArray(data.results) ? data.results : []

    // ── Pick best match ───────────────────────────────────────────────────────
    // 1. Exact name match wins immediately.
    // 2. Otherwise score all candidates by title similarity (F1 word-overlap).
    //    Require similarity ≥ 0.5 to accept any result.
    //    Among candidates that clear the threshold, prefer the most issues.
    // 3. If no candidate meets the threshold, return null — do NOT write a
    //    probably-wrong ID back to the DB via self-healing.
    const normalised = q.toLowerCase()
    let best = results.find(r => r.name?.toLowerCase() === normalised)

    if (!best && results.length > 0) {
      const SIMILARITY_THRESHOLD = 0.5

      const scored = results
        .map(r => ({ r, sim: titleSimilarity(q, r.name ?? '') }))
        .filter(({ sim }) => sim >= SIMILARITY_THRESHOLD)
        .sort((a, b) =>
          // Primary: similarity desc; secondary: issue count desc (tiebreaker only)
          b.sim !== a.sim
            ? b.sim - a.sim
            : (b.r.count_of_issues ?? 0) - (a.r.count_of_issues ?? 0)
        )

      best = scored[0]?.r ?? undefined
    }

    const result = {
      volumeId:   best ? String(best.id) : null,
      name:       best?.name ?? null,
      // Include similarity metadata so CVIssuesGrid can apply its own confidence gate
      startYear:  best?.start_year ?? null,
      publisher:  best?.publisher?.name ?? null,
    }

    // Only cache definitive answers (even null — avoids hammering CV for unknown titles)
    await cvSet('search', cacheKey, result)
    return NextResponse.json(result)

  } catch (err) {
    console.error('[/api/comic/search] Unexpected error:', err)
    return NextResponse.json({ volumeId: null, name: null })
  }
}
