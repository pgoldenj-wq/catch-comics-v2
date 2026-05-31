'use client'

/**
 * useIssueList — shared hook that resolves a CV volume id and fetches its
 * issue list. Used by both CVIssuesGrid (the legacy 3-col grid renderer)
 * and IssueCarousel (the new horizontal-scroll renderer).
 *
 * Resolution order matches CVIssuesGrid's original implementation:
 *   1. comicvineId prop — used directly if present
 *   2. /api/comic/search?q={searchTitle} — fallback that finds a volume id
 *   3. self-healing PATCH — writes the discovered id back to the DB so
 *      future page loads skip the search
 *
 * Both fetches hit endpoints that are KV-cached server-side, so calling
 * the hook from multiple components on the same page page is cheap.
 */

import { useState, useEffect, useRef } from 'react'

export interface Issue {
  id:           number
  issue_number: string
  name:         string | null
  image:        { small_url: string; medium_url: string }
  cover_year:   string
}

interface UseIssueListResult {
  issues:  Issue[] | null   // null while loading, [] when none found
  loading: boolean
}

const SELF_HEAL_THRESHOLD = 0.45

// Inlined from /api/comic/search route — same word-overlap similarity scorer
function titleSimilarity(query: string, candidate: string): number {
  const STOP = new Set(['the','a','an','of','and','vol','volume',
    'edition','book','part','absolute','omnibus','deluxe','complete'])
  const tokenise = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
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

export function useIssueList(
  comicvineId: string | null | undefined,
  searchTitle: string | null | undefined,
  productSlug: string | null | undefined,
): UseIssueListResult {
  const [issues, setIssues]   = useState<Issue[] | null>(null)
  const fetchedRef            = useRef(false)

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true

    async function load() {
      let volumeId: string | null = comicvineId ?? null

      // Search fallback when no volume id is on the product yet
      if (!volumeId && searchTitle) {
        try {
          const r = await fetch(`/api/comic/search?q=${encodeURIComponent(searchTitle)}`)
          if (r.ok) {
            const data = await r.json() as { volumeId: string | null; name: string | null }
            volumeId = data.volumeId ?? null

            // Self-heal — only when name similarity is high enough to trust
            const returnedName = data.name ?? ''
            const confident =
              volumeId && productSlug && searchTitle &&
              titleSimilarity(searchTitle, returnedName) >= SELF_HEAL_THRESHOLD
            if (confident) {
              fetch(`/api/product/${productSlug}/comicvine-id`, {
                method:  'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ comicvineId: volumeId }),
              }).catch(() => { /* non-critical */ })
            }
          }
        } catch {
          // Search network failure — fall through to empty state
        }
      }

      if (!volumeId) { setIssues([]); return }

      try {
        const r = await fetch(`/api/comic/${volumeId}/issues`)
        if (r.ok) {
          const data = await r.json() as { issues?: unknown }
          setIssues(Array.isArray(data.issues) ? data.issues as Issue[] : [])
        } else {
          setIssues([])
        }
      } catch {
        setIssues([])
      }
    }

    load()
  }, [comicvineId, searchTitle, productSlug])

  return { issues, loading: issues === null }
}
