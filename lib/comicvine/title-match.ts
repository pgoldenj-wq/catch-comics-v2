/**
 * lib/comicvine/title-match.ts — one implementation of "is this the same book",
 * and one server-side volume lookup.
 *
 * `titleSimilarity` existed twice, copy-pasted into app/api/comic/search and
 * components/useIssueList. Two copies of a trust decision is one too many: the
 * client's copy was the only thing standing between an anonymous caller and a
 * write to canonical_products, and nothing on the server re-checked it.
 *
 * Both thresholds live here so the search endpoint and the self-heal write
 * cannot drift apart.
 */

import { cvFetch, cvGet, cvSet } from '@/lib/comicvine'

/** Minimum similarity for /api/comic/search to return a volume at all. */
export const SIMILARITY_THRESHOLD = 0.5

/** Minimum similarity before a self-heal is allowed to WRITE the id back. */
export const SELF_HEAL_THRESHOLD = 0.45

interface CVVolume {
  id: number
  name: string
  count_of_issues: number
  start_year: string | null
  publisher: { name: string } | null
}

export interface VolumeMatch {
  volumeId:  string | null
  name:      string | null
  startYear: string | null
  publisher: string | null
}

/**
 * Symmetric word-overlap similarity between two strings, in [0, 1].
 *
 * F1-style harmonic mean of precision and recall over tokenised words, so a
 * short candidate ("Batman") scores poorly against a long specific query
 * ("Absolute Batman Volume 2 Abomination") instead of matching it outright.
 * Common edition/format noise words are stripped first.
 */
export function titleSimilarity(query: string, candidate: string): number {
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

  const precision = hits / qWords.size
  const recall    = hits / cWords.size

  if (precision + recall === 0) return 0
  return (2 * precision * recall) / (precision + recall)
}

/**
 * Find the best Comic Vine volume for a title, server-side.
 *
 * Shared by GET /api/comic/search and the self-heal write, so the id a caller
 * can read is computed by exactly the code that decides what may be stored.
 *
 * Returns `{ volumeId: null }` when nothing clears SIMILARITY_THRESHOLD, when
 * the breaker is open, or when no API key is configured — never a guess.
 * Definitive answers are cached (nulls included, so an unknown title does not
 * re-spend Comic Vine's 200/hour budget on every page view).
 */
export async function searchVolumeByTitle(q: string): Promise<VolumeMatch> {
  const EMPTY: VolumeMatch = { volumeId: null, name: null, startYear: null, publisher: null }

  const cacheKey = `cv-search-vol:${q.toLowerCase()}`
  const cached = await cvGet<VolumeMatch>('search', cacheKey)
  if (cached !== null) return cached

  const apiKey = process.env.COMIC_VINE_API_KEY
  if (!apiKey) {
    console.error('[cv/title-match] COMIC_VINE_API_KEY not set')
    return EMPTY
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
    // Circuit open or 429 — return empty and do NOT cache, so it retries later.
    if (!res) return EMPTY

    const data = await res.json()
    const results: CVVolume[] = Array.isArray(data.results) ? data.results : []

    // 1. Exact name match wins immediately.
    // 2. Otherwise score every candidate and require SIMILARITY_THRESHOLD.
    //    Among those that clear it, prefer the most issues.
    // 3. Nothing clears it → null. Never write a probably-wrong id back.
    const normalised = q.toLowerCase()
    let best = results.find(r => r.name?.toLowerCase() === normalised)

    if (!best && results.length > 0) {
      const scored = results
        .map(r => ({ r, sim: titleSimilarity(q, r.name ?? '') }))
        .filter(({ sim }) => sim >= SIMILARITY_THRESHOLD)
        .sort((a, b) =>
          b.sim !== a.sim
            ? b.sim - a.sim
            : (b.r.count_of_issues ?? 0) - (a.r.count_of_issues ?? 0)
        )
      best = scored[0]?.r ?? undefined
    }

    const result: VolumeMatch = {
      volumeId:  best ? String(best.id) : null,
      name:      best?.name ?? null,
      startYear: best?.start_year ?? null,
      publisher: best?.publisher?.name ?? null,
    }

    await cvSet('search', cacheKey, result)
    return result

  } catch (err) {
    console.error('[cv/title-match] Unexpected error:', err)
    return EMPTY
  }
}
