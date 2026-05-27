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
}

export default function CVIssuesGrid({
  comicvineId,
  searchTitle,
  productSlug,
  comicTitle,
}: Props) {
  const router = useRouter()
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const fetchedRef = useRef(false)

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
            const data = await r.json() as { volumeId: string | null }
            volumeId = data.volumeId ?? null

            // ── Step 2: Self-heal — write ID back to DB (fire-and-forget) ─
            if (volumeId && productSlug) {
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
          Issues in this series
        </h2>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {[...Array(6)].map((_, i) => (
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
          Issues in this series
        </h2>
        <span className="text-xs text-gray-400">{issues.length}</span>
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {issues.map(issue => {
          const cover = issue.image?.medium_url || issue.image?.small_url || ''
          const label = issue.issue_number ? `#${issue.issue_number}` : (issue.name || 'Issue')
          return (
            <button
              key={issue.id}
              onClick={() => router.push(`/comic/i${issue.id}`)}
              style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }}
            >
              {/* Cover — 3× zoom on hover; transformOrigin top-left so it expands inward */}
              <div
                className="relative bg-gray-100 border border-gray-200 rounded-md transition-transform duration-300 ease-out hover:scale-[3] hover:z-50"
                style={{ aspectRatio: '2 / 3', position: 'relative', transformOrigin: 'top left' }}
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
