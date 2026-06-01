'use client'

import Link from 'next/link'
import type { SeriesEntry }    from '@/lib/series/types'
import type { SeriesPageData } from '@/lib/series/types'

interface Props {
  entry:      SeriesEntry
  seriesData: SeriesPageData
}

export default function SeriesHero({ entry, seriesData }: Props) {
  const { description, heroCoverUrl, volumes } = seriesData
  const firstVolume = volumes[0] ?? null
  const currency    = firstVolume?.currency === 'USD' ? '$' : '£'
  const fromPrice   = firstVolume?.lowestPrice
    ? `From ${currency}${firstVolume.lowestPrice.toFixed(2)}`
    : null

  return (
    <section
      className="relative text-white overflow-hidden"
      style={{ background: '#111827' }}
    >
      {/* Dot grid — matches homepage / product page hero */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)',
          backgroundSize:  '22px 22px',
        }}
      />
      {/* Red glow accent */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          top: '-80px', right: '-80px',
          width: '420px', height: '420px',
          background: 'radial-gradient(circle, rgba(232,39,42,0.14) 0%, transparent 65%)',
        }}
      />

      <div className="relative max-w-6xl mx-auto px-4 py-10 sm:py-14">
        <div className="flex flex-col sm:flex-row gap-8 sm:gap-12 items-start">

          {/* ── Cover ────────────────────────────────────────────────────── */}
          <div className="flex-shrink-0 mx-auto sm:mx-0">
            <div
              className="rounded-xl overflow-hidden shadow-2xl bg-white/5 flex items-center justify-center"
              style={{ width: '160px', height: '240px' }}
            >
              {heroCoverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={heroCoverUrl}
                  alt={entry.displayName}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                />
              ) : (
                <svg
                  width="48" height="48" viewBox="0 0 24 24"
                  fill="none" stroke="rgba(255,255,255,0.2)"
                  strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
              )}
            </div>
          </div>

          {/* ── Metadata ─────────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0">
            {/* Eyebrow */}
            <p style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#E8272A', marginBottom: '12px' }}>
              {entry.publisher}
            </p>

            {/* Series name */}
            <h1
              className="font-bold leading-tight text-white"
              style={{ fontSize: 'clamp(1.75rem, 4vw, 3rem)', letterSpacing: '-0.025em', marginBottom: '8px' }}
            >
              {entry.displayName}
            </h1>

            {/* Volume count + price */}
            <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)', marginBottom: '20px' }}>
              {volumes.length} {volumes.length === 1 ? 'volume' : 'volumes'}
              {fromPrice && (
                <> &middot; <span style={{ color: '#E8272A', fontWeight: 600 }}>{fromPrice}</span></>
              )}
            </p>

            {/* Description */}
            {description && (
              <p style={{
                fontSize: '14px', lineHeight: 1.7,
                color: 'rgba(255,255,255,0.7)',
                maxWidth: '560px',
                marginBottom: '28px',
                display: '-webkit-box',
                WebkitLineClamp: 4,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}>
                {description}
              </p>
            )}

            {/* CTA */}
            {firstVolume && (
              <Link
                href={`/product/${firstVolume.slug}`}
                style={{
                  display:        'inline-flex',
                  alignItems:     'center',
                  gap:            '8px',
                  background:     '#E8272A',
                  color:          '#fff',
                  fontSize:       '14px',
                  fontWeight:     700,
                  padding:        '10px 22px',
                  borderRadius:   '999px',
                  textDecoration: 'none',
                  transition:     'background 0.15s',
                }}
                onMouseEnter={undefined}
              >
                Start Reading
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
