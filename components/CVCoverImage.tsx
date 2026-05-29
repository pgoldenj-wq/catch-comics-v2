'use client'

/**
 * CVCoverImage — smart cover image for product pages.
 *
 * Priority:
 *   1. DB cover (if not a known-bad URL)
 *   2. Live Comic Vine image fetched from /api/comic/{comicvineId}
 *      — only when comicvineId is set AND DB cover is null/bad.
 *      — shares the same API route already called by CVCharacterTags;
 *        Vercel KV caches the CV response so no extra CV API calls.
 *   3. Designed placeholder (always rendered as base layer, never blank)
 *
 * Constraints:
 *   - One fetch only, guarded by useRef (React StrictMode safe).
 *   - Uses <img> not next/image: comicvine.gamespot.com is not in
 *     next.config remotePatterns, and this component handles mixed
 *     URL sources (CV, OL, retailer CDNs).
 *   - Does not affect products without comicvineId.
 */

import { useState, useEffect, useRef } from 'react'
import { isBadCoverUrl, adjustImgSrc as adjustSrc } from '@/lib/images/url-filters'

interface Props {
  dbCoverUrl:  string | null
  comicvineId: string | null
  title:       string
  /** Tailwind classes for sizing + shape — applied to the outer container */
  className?:  string
}

export default function CVCoverImage({ dbCoverUrl, comicvineId, title, className }: Props) {
  const dbGood         = !isBadCoverUrl(dbCoverUrl)
  const needsLiveFetch = !dbGood && !!comicvineId

  const [liveCover, setLiveCover] = useState<string | null>(null)
  const fetchedRef = useRef(false)

  useEffect(() => {
    // Guard: only fetch when DB cover is bad/missing and comicvineId is present.
    // useRef prevents double-fire in React StrictMode.
    if (!needsLiveFetch || fetchedRef.current) return
    fetchedRef.current = true

    fetch(`/api/comic/${comicvineId}`)
      .then(r => r.json())
      .then(data => {
        const img = data.comic?.image as { original_url?: string; medium_url?: string } | undefined
        // Prefer original_url (higher res) then medium_url — same as /comic/[id] page
        const url = img?.original_url || img?.medium_url || null
        if (url && !isBadCoverUrl(url)) setLiveCover(url)
      })
      .catch(() => { /* silently fall through to placeholder */ })
  }, [comicvineId, needsLiveFetch])

  // Resolved display URL: DB cover (priority 1) → live CV (priority 2) → null (placeholder)
  const src: string | null = dbGood
    ? adjustSrc(dbCoverUrl!)
    : liveCover
      ? adjustSrc(liveCover)
      : null

  return (
    <div
      className={`relative overflow-hidden ${className ?? ''}`}
      style={{ background: '#F3F4F6' }}
    >
      {/* Placeholder — always the base layer; hidden by the image when it loads OK */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-400">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
        <span className="text-xs font-medium">No cover</span>
      </div>

      {/* Image — overlays placeholder. Hidden via display:none if it fails or is 1×1 */}
      {src && (
        <img
          src={src}
          alt={`Cover of ${title}`}
          className="absolute inset-0 w-full h-full object-cover"
          // fetchpriority="high" equivalent — hint browser to load this early (above the fold)
          loading="eager"
          onLoad={e => {
            const img = e.currentTarget
            if (img.naturalWidth <= 1 || img.naturalHeight <= 1) img.style.display = 'none'
          }}
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
        />
      )}
    </div>
  )
}
