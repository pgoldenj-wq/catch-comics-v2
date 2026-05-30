'use client'

/**
 * CVIssuesGrid — fetches the issue list for a Comic Vine volume and renders
 * a 3-column thumbnail grid, matching the design used in /comic/[id].
 *
 * Resolution order:
 *   1. comicvineId prop (fastest — already in DB)
 *   2. Title search via /api/comic/search?q=<searchTitle> (fallback)
 *      → on success, fires a self-healing PATCH to write the ID back to DB
 *        so future loads use path 1 immediately.
 *
 * Renders nothing if no issues are found or all CV calls fail.
 * Each issue thumbnail links to /comic/i{issueId} for full single-issue detail.
 */

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { isBadCoverUrl } from '@/lib/images/url-filters'

/**
 * Mirrors the word-overlap similarity from /api/comic/search — used as an
 * extra client-side guard before firing the self-healing PATCH.
 * Returns a value in [0, 1].
 */
function titleSimilarity(query: string, candidate: string): number {
  const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'vol', 'volume',
    'edition', 'book', 'part', 'absolute', 'omnibus', 'deluxe', 'complete'])
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

interface Issue {
  id: number
  issue_number: string
  name: string | null
  image: { small_url: string; medium_url: string }
  cover_year: string
}

interface Props {
  /** Comic Vine volume ID already stored in DB. If set, used directly. */
  comicvineId?: string | null
  /** Product title used to search CV when comicvineId is null. */
  searchTitle?: string | null
  /** Canonical slug — used by the self-healing PATCH endpoint. */
  productSlug?: string | null
  /** Display title for alt text and the section label. */
  comicTitle: string
  /** Section header label. Default "Issues in this series". Use
   *  "Inside this collection" on collected-edition pages where the grid
   *  represents nested-children rather than sibling-navigation. */
  label?: string
  /** Grid columns at the resting layout. 3 for narrow side panel,
   *  6 for full-width editorial gallery. Default 3. */
  columns?: number
  /** Optional callback fired once the issue list is fetched, with the
   *  total count. Lets the parent surface "Collects N issues" labels
   *  in the hero block. */
  onLoaded?: (count: number) => void
}

export default function CVIssuesGrid({
  comicvineId,
  searchTitle,
  productSlug,
  comicTitle,
  label   = 'Issues in this series',
  columns = 3,
  onLoaded,
}: Props) {
  const router = useRouter()
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const fetchedRef = useRef(false)
  const onLoadedRef = useRef(onLoaded)
  useEffect(() => { onLoadedRef.current = onLoaded }, [onLoaded])
  useEffect(() => {
    if (issues) onLoadedRef.current?.(issues.length)
  }, [issues])

  useEffect(() => {
    // Guard against double-invocation in React StrictMode / dev
    if (fetchedRef.current) return
    fetchedRef.current = true

    async function load() {
      // ── Step 1: Resolve volume ID ───────────────────────────────────────
      let volumeId: string | null = comicvineId ?? null

      if (!volumeId && searchTitle) {
        try {
          const r = await fetch(`/api/comic/search?q=${encodeURIComponent(searchTitle)}`)
          if (r.ok) {
            const data = await r.json() as { volumeId: string | null; name: string | null }
            volumeId = data.volumeId ?? null

            // ── Step 2: Self-heal — write ID back to DB (fire-and-forget) ─
            // Only fire when the returned name has reasonable overlap with our
            // search title. This prevents writing wrong IDs for new series where
            // CV returns an unrelated high-issue-count volume as the top result.
            const SELF_HEAL_THRESHOLD = 0.45
            const returnedName = data.name ?? ''
            const confident =
              volumeId &&
              productSlug &&
              searchTitle &&
              titleSimilarity(searchTitle, returnedName) >= SELF_HEAL_THRESHOLD

            if (confident) {
              fetch(`/api/product/${productSlug}/comicvine-id`, {
                method:  'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ comicvineId: volumeId }),
              }).catch(() => {
                // Non-critical — next page load will try again
              })
            }
          }
        } catch {
          // Search network failure — fall through to empty state
        }
      }

      if (!volumeId) {
        setIssues([])
        return
      }

      // ── Step 3: Fetch issues for the resolved volume ID ─────────────────
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

  // ── Loading skeleton ─────────────────────────────────────────────────────
  if (issues === null) {
    return (
      <div>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          {label}
        </h2>
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
          {[...Array(columns * 2)].map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="bg-gray-100 rounded-md" style={{ aspectRatio: '2 / 3' }} />
              <div className="h-2.5 bg-gray-100 rounded mt-1.5 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Nothing found — render nothing (right column collapses visually)
  if (issues.length === 0) return null

  // ── Issue grid ───────────────────────────────────────────────────────────
  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
          {label}
        </h2>
        <span className="text-xs text-gray-400">{issues.length} issue{issues.length === 1 ? '' : 's'}</span>
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {issues.map(issue => {
          const rawCover = issue.image?.medium_url || issue.image?.small_url || ''
          const cover    = rawCover && !isBadCoverUrl(rawCover) ? rawCover : ''
          const label    = issue.issue_number ? `#${issue.issue_number}` : (issue.name || 'Issue')
          return (
            <button
              key={issue.id}
              onClick={() => router.push(`/comic/i${issue.id}`)}
              style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }}
            >
              {/* Cover — 3× zoom on hover; transformOrigin center so it BLOOMS outward
                  from the thumbnail (rather than sliding down-right from top-left).
                  z-50 + ring keep the enlarged cover layered above its grid siblings. */}
              <div
                className="relative bg-gray-100 border border-gray-200 rounded-md transition-transform duration-200 ease-out hover:scale-[3] hover:z-50 hover:shadow-2xl"
                style={{ aspectRatio: '2 / 3', position: 'relative', transformOrigin: 'center center' }}
              >
                <span className="absolute inset-0 flex items-center justify-center text-gray-400 text-[10px] font-medium">
                  {label}
                </span>
                {cover && (
                  <img
                    src={cover}
                    alt={`${comicTitle} ${label}`}
                    className="absolute inset-0 w-full h-full object-cover rounded-md"
                    loading="lazy"
                    onLoad={e => {
                      const img = e.currentTarget
                      if (img.naturalWidth <= 1 || img.naturalHeight <= 1) img.style.display = 'none'
                    }}
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                  />
                )}
              </div>
              <div
                style={{
                  marginTop:    '4px',
                  fontSize:     '11px',
                  fontWeight:   500,
                  color:        '#111827',
                  overflow:     'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace:   'nowrap',
                }}
              >
                {label}
              </div>
              {issue.cover_year && (
                <div style={{ fontSize: '10px', color: '#9CA3AF' }}>{issue.cover_year}</div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
