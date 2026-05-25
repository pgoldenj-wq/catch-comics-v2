'use client'

/**
 * CVIssuesGrid — fetches the issue list for a Comic Vine volume and renders
 * a 3-column thumbnail grid, matching the design used in /comic/[id].
 *
 * Only mounts when a comicvineId is available on the canonical product.
 * Renders nothing if CV returns no issues or the fetch fails.
 * Each issue thumbnail links to /comic/i{issueId} for full single-issue detail.
 */

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Issue {
  id: number
  issue_number: string
  name: string | null
  image: { small_url: string; medium_url: string }
  cover_year: string
}

interface Props {
  comicvineId: string
  comicTitle: string
}

export default function CVIssuesGrid({ comicvineId, comicTitle }: Props) {
  const router = useRouter()
  const [issues, setIssues] = useState<Issue[] | null>(null)

  useEffect(() => {
    fetch(`/api/comic/${comicvineId}/issues`)
      .then(r => r.json())
      .then(data => setIssues(Array.isArray(data.issues) ? data.issues : []))
      .catch(() => setIssues([]))
  }, [comicvineId])

  // Loading skeleton
  if (issues === null) {
    return (
      <div>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Issues in this series</h2>
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

  if (issues.length === 0) return null

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Issues in this series</h2>
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
              <div style={{ marginTop: '4px', fontSize: '11px', fontWeight: 500, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
