'use client'

/**
 * CVIssuesGrid — 3-column thumbnail grid of issues for a Comic Vine volume.
 *
 * Data fetching lives in the shared `useIssueList` hook so this component
 * and the new `IssueCarousel` consume the same KV-cached endpoints.
 * Renders nothing when no issues are found (silent collapse).
 */

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { isBadCoverUrl } from '@/lib/images/url-filters'
import { useIssueList } from './useIssueList'

interface Props {
  /** Comic Vine volume ID already stored in DB. If set, used directly. */
  comicvineId?: string | null
  /** Product title used to search CV when comicvineId is null. */
  searchTitle?: string | null
  /** Canonical slug — used by the self-healing PATCH endpoint. */
  productSlug?: string | null
  /** Display title for alt text and the section label. */
  comicTitle: string
  /** Section header label. Pass empty string to skip the header — useful
   *  when the parent provides a section-level eyebrow above the grid. */
  label?: string
  /** Grid columns at the resting layout. Default 3. */
  columns?: number
  /** Optional callback fired once the issue list is fetched, with the
   *  total count. */
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
  const { issues } = useIssueList(comicvineId, searchTitle, productSlug)

  // Forward count to onLoaded — ref-isolated so callers can pass inline arrows
  const onLoadedRef = useRef(onLoaded)
  useEffect(() => { onLoadedRef.current = onLoaded }, [onLoaded])
  useEffect(() => {
    if (issues) onLoadedRef.current?.(issues.length)
  }, [issues])

  // ── Loading skeleton ─────────────────────────────────────────────────────
  if (issues === null) {
    return (
      <div>
        {label && (
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
            {label}
          </h2>
        )}
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

  // Nothing found — render nothing (column collapses visually)
  if (issues.length === 0) return null

  // ── Issue grid ───────────────────────────────────────────────────────────
  return (
    <div>
      {label && (
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
            {label}
          </h2>
          <span className="text-xs text-gray-400">{issues.length} issue{issues.length === 1 ? '' : 's'}</span>
        </div>
      )}
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {issues.map(issue => {
          const rawCover = issue.image?.medium_url || issue.image?.small_url || ''
          const cover    = rawCover && !isBadCoverUrl(rawCover) ? rawCover : ''
          const cardLabel = issue.issue_number ? `#${issue.issue_number}` : (issue.name || 'Issue')
          return (
            <button
              key={issue.id}
              onClick={() => router.push(`/comic/i${issue.id}`)}
              style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }}
            >
              <div
                className="cover-card-md relative bg-gray-100 border border-gray-200 rounded-md"
                style={{ aspectRatio: '2 / 3' }}
              >
                <span className="absolute inset-0 flex items-center justify-center text-gray-400 text-[10px] font-medium">
                  {cardLabel}
                </span>
                {cover && (
                  <img
                    src={cover}
                    alt={`${comicTitle} ${cardLabel}`}
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
                {cardLabel}
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
