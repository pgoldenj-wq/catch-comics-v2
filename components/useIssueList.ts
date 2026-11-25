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

// The similarity scorer that used to be inlined here is gone. It guarded a
// public write from the browser, which is not a gate a client can hold: the
// server took the id on trust and never re-checked it. The one implementation
// now lives in lib/comicvine/title-match.ts and runs server-side, inside the
// route that performs the write.

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

            // Ask the server to self-heal. It does NOT take the id from here:
            // it reads the product's own title, repeats this lookup itself and
            // applies the same confidence gate server-side. The browser cannot
            // choose what gets stored, so nothing is sent but the slug.
            //
            // The local similarity check that used to guard this call is gone
            // with it — it was the only gate on a public write, which is not a
            // job a client can do. Asking when the server will decline costs
            // one throttled request and no Comic Vine quota (the route returns
            // before any CV call once the id is set).
            if (volumeId && productSlug) {
              fetch(`/api/product/${productSlug}/comicvine-id`, { method: 'PATCH' })
                .catch(() => { /* non-critical */ })
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
