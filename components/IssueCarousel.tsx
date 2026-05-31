'use client'

/**
 * IssueCarousel — horizontal scroll component for issue covers.
 *
 * Behaviour:
 *   • Native horizontal scroll with CSS scroll-snap for smooth touch + mouse
 *   • Left / right arrow buttons (subtle, premium) that fade at scroll limits
 *   • Pointer drag-to-scroll on desktop (mouse + pen + touch all unified)
 *   • Keyboard nav: ArrowLeft / ArrowRight on the focused scroll region
 *   • Smooth animation via CSS scroll-behavior
 *   • NOT infinite — clear start and end
 *
 * Cards link to /comic/i{issueId} matching the existing CV-issue route.
 *
 * Data:
 *   • Consumes the shared `useIssueList` hook (same fetch as CVIssuesGrid),
 *     so KV cache is shared and the call is free if either component already
 *     mounted on the page.
 *   • `currentIssueId` (number) highlights the card with matching CV issue id
 *     — for the SINGLE_ISSUE product page "you are here" affordance.
 *
 * Renders nothing when the volume has no issues (silent collapse).
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { isBadCoverUrl } from '@/lib/images/url-filters'
import { useIssueList, type Issue } from './useIssueList'

interface Props {
  comicvineId?:   string | null
  searchTitle?:   string | null
  productSlug?:   string | null
  comicTitle:     string
  /** Section header label, e.g. "Collects Issues" / "Issues In This Series". */
  label?:         string
  /** CV issue id of the currently-viewed product (SINGLE_ISSUE pages only).
   *  When the carousel renders a card with id === currentIssueId, that card
   *  gets a red border accent + slight scale + "Currently viewing" caption. */
  currentIssueId?: number | string | null
  onLoaded?:      (count: number) => void
}

const CARD_WIDTH    = 132   // px — cover 120 + padding/border
const SCROLL_STEP   = 4     // cards advanced per arrow click

export default function IssueCarousel({
  comicvineId,
  searchTitle,
  productSlug,
  comicTitle,
  label = 'Issues',
  currentIssueId,
  onLoaded,
}: Props) {
  const router = useRouter()
  const { issues } = useIssueList(comicvineId, searchTitle, productSlug)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd,   setAtEnd]   = useState(false)

  // ── onLoaded callback bridge ─────────────────────────────────────────────
  const onLoadedRef = useRef(onLoaded)
  useEffect(() => { onLoadedRef.current = onLoaded }, [onLoaded])
  useEffect(() => {
    if (issues) onLoadedRef.current?.(issues.length)
  }, [issues])

  // ── Scroll-position bookkeeping (drives arrow fade state) ────────────────
  const updateBounds = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setAtStart(el.scrollLeft <= 4)
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4)
  }, [])

  useEffect(() => {
    updateBounds()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', updateBounds, { passive: true })
    window.addEventListener('resize', updateBounds)
    return () => {
      el.removeEventListener('scroll', updateBounds)
      window.removeEventListener('resize', updateBounds)
    }
  }, [updateBounds, issues])

  // ── Arrow nav ────────────────────────────────────────────────────────────
  const scrollBy = useCallback((dir: 1 | -1) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir * CARD_WIDTH * SCROLL_STEP, behavior: 'smooth' })
  }, [])

  // ── Keyboard nav (when the scroll container has focus) ───────────────────
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); scrollBy(1) }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); scrollBy(-1) }
  }

  // ── Pointer drag-to-scroll ───────────────────────────────────────────────
  // Tracks pointer movement and translates dx into scrollLeft. setPointerCapture
  // means the drag continues even if the cursor leaves the element. We avoid
  // hijacking ordinary clicks by only suppressing the next click if a real drag
  // (>5px movement) occurred — otherwise card links work normally.
  const dragRef = useRef({ active: false, startX: 0, startScroll: 0, moved: 0 })
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (!el) return
    // Skip drag for touch (native scroll is better) — only mouse/pen drag here
    if (e.pointerType === 'touch') return
    dragRef.current = { active: true, startX: e.clientX, startScroll: el.scrollLeft, moved: 0 }
    el.setPointerCapture(e.pointerId)
    el.style.cursor = 'grabbing'
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return
    const el = scrollRef.current
    if (!el) return
    const dx = e.clientX - dragRef.current.startX
    dragRef.current.moved = Math.max(dragRef.current.moved, Math.abs(dx))
    el.scrollLeft = dragRef.current.startScroll - dx
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return
    const el = scrollRef.current
    if (el) el.style.cursor = ''
    dragRef.current.active = false
    // releasePointerCapture is automatic on pointer-up
    void e
  }
  // Suppress click-through if a meaningful drag happened
  const onClickCapture = (e: React.MouseEvent) => {
    if (dragRef.current.moved > 5) { e.preventDefault(); e.stopPropagation() }
    dragRef.current.moved = 0
  }

  // ── Loading skeleton ─────────────────────────────────────────────────────
  if (issues === null) {
    return (
      <div>
        {label && (
          <h2 className="text-xl font-semibold text-[#0A0A0A] mb-4">
            {label}
          </h2>
        )}
        <div className="flex gap-3 overflow-hidden">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex-shrink-0 animate-pulse" style={{ width: 120 }}>
              <div className="bg-gray-100 rounded-md" style={{ aspectRatio: '2 / 3' }} />
              <div className="h-3 bg-gray-100 rounded mt-2 w-3/4" />
              <div className="h-2 bg-gray-100 rounded mt-1 w-1/3" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Silent collapse when CV returns nothing
  if (issues.length === 0) return null

  return (
    <div>
      {/* Scoped scrollbar-hide (no Tailwind class for it by default) */}
      <style>{`
        .ic-scroll { scrollbar-width: none; -ms-overflow-style: none; }
        .ic-scroll::-webkit-scrollbar { display: none; }
      `}</style>

      {label && (
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-xl font-semibold text-[#0A0A0A]">
            {label}
          </h2>
          <span className="text-sm text-gray-400">{issues.length} issue{issues.length === 1 ? '' : 's'}</span>
        </div>
      )}

      <div className="relative">
        {/* Left arrow */}
        <button
          type="button"
          aria-label="Scroll left"
          onClick={() => scrollBy(-1)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-white/95 shadow-md border border-gray-200 flex items-center justify-center transition-opacity hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#E8272A]"
          style={{ opacity: atStart ? 0 : 1, pointerEvents: atStart ? 'none' : 'auto' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        {/* Right arrow */}
        <button
          type="button"
          aria-label="Scroll right"
          onClick={() => scrollBy(1)}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-9 h-9 rounded-full bg-white/95 shadow-md border border-gray-200 flex items-center justify-center transition-opacity hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#E8272A]"
          style={{ opacity: atEnd ? 0 : 1, pointerEvents: atEnd ? 'none' : 'auto' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>

        {/* Scroll container */}
        <div
          ref={scrollRef}
          role="region"
          aria-label={label || 'Issue carousel'}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClickCapture={onClickCapture}
          className="ic-scroll flex gap-3 overflow-x-auto pb-2 focus:outline-none"
          style={{
            scrollBehavior:    'smooth',
            scrollSnapType:    'x mandatory',
            cursor:            'grab',
            // pad the inner edges so the first/last card isn't hidden by the arrows
            paddingLeft:       '4px',
            paddingRight:      '4px',
          }}
        >
          {issues.map(issue => {
            const isCurrent = currentIssueId != null && String(issue.id) === String(currentIssueId)
            return (
              <IssueCard
                key={issue.id}
                issue={issue}
                comicTitle={comicTitle}
                isCurrent={isCurrent}
                onClick={() => router.push(`/comic/i${issue.id}`)}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Card ─────────────────────────────────────────────────────────────────────

function IssueCard({
  issue, comicTitle, isCurrent, onClick,
}: {
  issue: Issue; comicTitle: string; isCurrent: boolean; onClick: () => void
}) {
  const rawCover = issue.image?.medium_url || issue.image?.small_url || ''
  const cover    = rawCover && !isBadCoverUrl(rawCover) ? rawCover : ''
  const label    = issue.issue_number ? `Issue #${issue.issue_number}` : (issue.name || 'Issue')

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-shrink-0 text-left focus:outline-none group"
      style={{ width: 120, scrollSnapAlign: 'start' }}
      aria-label={isCurrent ? `${label} (currently viewing)` : label}
    >
      <div
        className={`relative bg-gray-100 rounded-md overflow-hidden transition-all duration-200 ${
          isCurrent
            ? 'ring-2 ring-[#E8272A] shadow-md'
            : 'border border-gray-200 group-hover:shadow-md group-hover:-translate-y-0.5'
        }`}
        style={{ aspectRatio: '2 / 3' }}
      >
        <span className="absolute inset-0 flex items-center justify-center text-gray-400 text-[10px] font-medium">
          #{issue.issue_number || '?'}
        </span>
        {cover && (
          <img
            src={cover}
            alt={`${comicTitle} ${label}`}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
            draggable={false}
            onLoad={e => {
              const img = e.currentTarget
              if (img.naturalWidth <= 1 || img.naturalHeight <= 1) img.style.display = 'none'
            }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        )}
      </div>
      <div className="mt-2">
        <div className={`text-[12px] font-semibold truncate ${isCurrent ? 'text-[#E8272A]' : 'text-gray-900'}`}>
          {label}
        </div>
        <div className="text-[11px] text-gray-400 flex items-center gap-1.5">
          {issue.cover_year ? <span>{issue.cover_year}</span> : <span>&nbsp;</span>}
          {isCurrent && <span className="text-[#E8272A] font-medium">· You are here</span>}
        </div>
      </div>
    </button>
  )
}
