'use client'

/**
 * IssueListGrid — vertical 2-column grid of issue covers for the product
 * page side column. Replaces the older horizontal IssueCarousel.
 *
 * Why a vertical grid:
 *   - Side column placement (the new 3-col page layout puts issues in a
 *     narrow left rail). Vertical scroll is the natural fit; horizontal
 *     carousel mechanics fight the layout.
 *   - Better content density on tall viewports — users see more issues
 *     without interacting.
 *   - Accessibility: a vertical list of links is keyboard-traversable
 *     with Tab + Enter and screen-reader friendly without bespoke
 *     scroll-region semantics.
 *
 * Data:
 *   - Consumes the shared `useIssueList` hook (same KV-cached endpoints
 *     CVIssuesGrid uses) so adding this component to a page is free if
 *     the volume's issues are already cached.
 *   - `currentIssueId` highlights the matching card on SINGLE_ISSUE
 *     product pages with a brand-red ring + "You are here" caption.
 *
 * Cards:
 *   - Each card is a Next.js <Link> to /comic/i{id} — SEO-crawlable
 *     internal links (not router.push from a button).
 *   - Hover/focus scales the cover ~3× from centre with a bouncy
 *     cubic-bezier easing. Surrounding cards do NOT shift (transform
 *     is purely visual). Parent grid uses overflow:visible so the
 *     enlarged card is not clipped.
 *   - Respects prefers-reduced-motion via the rule in app/globals.css.
 *
 * Renders nothing when CV returns no issues (silent collapse).
 */

import Link from 'next/link'
import { isBadCoverUrl } from '@/lib/images/url-filters'
import { useIssueList } from './useIssueList'

interface Props {
  comicvineId?:    string | null
  searchTitle?:    string | null
  productSlug?:    string | null
  comicTitle:      string
  /** Section header. Default "Issues in this series". */
  label?:          string
  /** Grid columns at rest. Default 2 for the narrow side rail. */
  columns?:        number
  /** CV issue id of the currently-viewed product (SINGLE_ISSUE only). */
  currentIssueId?: number | string | null
}

export default function IssueListGrid({
  comicvineId,
  searchTitle,
  productSlug,
  comicTitle,
  label   = 'Issues in this series',
  columns = 2,
  currentIssueId,
}: Props) {
  const { issues } = useIssueList(comicvineId, searchTitle, productSlug)

  // ── Loading skeleton ─────────────────────────────────────────────────────
  if (issues === null) {
    return (
      <div>
        {label && <SectionHeader label={label} count={null} />}
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {[...Array(columns * 3)].map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="bg-gray-100 rounded-md" style={{ aspectRatio: '2 / 3' }} />
              <div className="h-3 bg-gray-100 rounded mt-2 w-3/4" />
              <div className="h-2 bg-gray-100 rounded mt-1 w-1/3" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Silent collapse — no header, no empty state
  if (issues.length === 0) return null

  return (
    <div>
      {label && <SectionHeader label={label} count={issues.length} />}

      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, overflow: 'visible' }}
      >
        {issues.map(issue => {
          const isCurrent = currentIssueId != null && String(issue.id) === String(currentIssueId)
          const rawCover  = issue.image?.medium_url || issue.image?.small_url || ''
          const cover     = rawCover && !isBadCoverUrl(rawCover) ? rawCover : ''
          const number    = issue.issue_number || '?'
          const cardLabel = `Issue #${number}`
          return (
            <Link
              key={issue.id}
              href={`/comic/i${issue.id}`}
              prefetch={false}
              aria-label={isCurrent ? `${cardLabel} (currently viewing)` : cardLabel}
              aria-current={isCurrent ? 'page' : undefined}
              className="block group focus:outline-none"
            >
              <div
                className={`cover-card relative bg-gray-100 rounded-md overflow-hidden ${
                  isCurrent ? 'ring-2 ring-[#E8272A]' : 'border border-gray-200'
                }`}
                style={{ aspectRatio: '2 / 3' }}
              >
                  {/* Placeholder layer — issue number always rendered behind cover */}
                  <span className="absolute inset-0 flex items-center justify-center text-gray-400 text-[10px] font-medium">
                    #{number}
                  </span>
                  {cover && (
                    <img
                      src={cover}
                      alt={`${comicTitle} ${cardLabel}`}
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
                  {cardLabel}
                </div>
                <div className="text-[11px] text-gray-400">
                  {issue.cover_year ? <span>{issue.cover_year}</span> : <span>&nbsp;</span>}
                  {isCurrent && <span className="text-[#E8272A] font-medium ml-1">· You are here</span>}
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function SectionHeader({ label, count }: { label: string; count: number | null }) {
  return (
    <div className="flex items-baseline justify-between mb-4">
      <h2 className="text-xl font-semibold text-[#0A0A0A]">{label}</h2>
      {count !== null && (
        <span className="text-sm text-gray-400">{count} issue{count === 1 ? '' : 's'}</span>
      )}
    </div>
  )
}
