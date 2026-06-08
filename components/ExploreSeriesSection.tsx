'use client'

/**
 * ExploreSeriesSection — Homepage "Explore Series" discovery block.
 *
 * Renders a responsive grid of 6 featured series cards with cover artwork,
 * volume count, and a "Browse all series →" CTA linking to /series.
 *
 * Strategy:
 *   - Static fallback (OpenLibrary covers, hardcoded counts) shown on first paint.
 *   - Fetches /api/series-preview on mount; replaces static data with live R2 covers
 *     and accurate volume counts from the DB.
 *   - If the fetch fails, the static fallback persists silently.
 *
 * Responsive:
 *   - Mobile  (<640px): 3-column grid  →  2 rows of 3
 *   - Desktop (≥640px): 6-column grid  →  1 row of 6
 *
 * Design system:
 *   - Background:   #F8F8F6  (matches homepage)
 *   - Section head: 15px / 600 / #111  (matches "Top deals today")
 *   - Sub-label:    11px / #6B7280
 *   - Cover cards:  #1a1a2e bg, cover-card-lg hover-zoom, 10px radius
 *   - Publisher:    10px / uppercase / #E8272A  (matches SeriesIndexCard)
 *   - Series name:  13px / 700 / #0A0A0A
 *   - Volume count: 11px / #6B7280
 */

import { useState, useEffect } from 'react'
import Link                    from 'next/link'

// ── Types ──────────────────────────────────────────────────────────────────────

interface FeaturedSeries {
  slug:         string
  displayName:  string
  publisher:    string
  heroCoverUrl: string | null
  volumeCount:  number
}

// ── Static fallback ────────────────────────────────────────────────────────────
// OpenLibrary cover URLs used on first paint (ISBNs from Vol 1 of each series).
// Replaced by /api/series-preview on mount, which returns live R2 covers.

const SERIES_FALLBACK: FeaturedSeries[] = [
  {
    slug:         'saga',
    displayName:  'Saga',
    publisher:    'Image Comics',
    volumeCount:  11,
    heroCoverUrl: 'https://covers.openlibrary.org/b/isbn/9781607066019-L.jpg',
  },
  {
    slug:         'the-walking-dead',
    displayName:  'The Walking Dead',
    publisher:    'Image Comics',
    volumeCount:  27,
    heroCoverUrl: 'https://covers.openlibrary.org/b/isbn/9781582406724-L.jpg',
  },
  {
    slug:         'invincible',
    displayName:  'Invincible',
    publisher:    'Image Comics',
    volumeCount:  11,
    heroCoverUrl: 'https://covers.openlibrary.org/b/isbn/9781582402697-L.jpg',
  },
  {
    slug:         'witch-hat-atelier',
    displayName:  'Witch Hat Atelier',
    publisher:    'Kodansha Comics',
    volumeCount:  14,
    heroCoverUrl: 'https://covers.openlibrary.org/b/isbn/9781632368072-L.jpg',
  },
  {
    slug:         'trigun-maximum-deluxe',
    displayName:  'Trigun Maximum Deluxe Edition',
    publisher:    'Dark Horse Comics',
    volumeCount:  5,
    heroCoverUrl: 'https://covers.openlibrary.org/b/isbn/9781506722429-L.jpg',
  },
  {
    slug:         'hellsing',
    displayName:  'Hellsing',
    publisher:    'Dark Horse Comics',
    volumeCount:  10,
    heroCoverUrl: 'https://covers.openlibrary.org/b/isbn/9781593070342-L.jpg',
  },
]

// ── SeriesCard ─────────────────────────────────────────────────────────────────

function SeriesCard({ s }: { s: FeaturedSeries }) {
  return (
    <Link
      href={`/series/${s.slug}`}
      style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
      aria-label={`${s.displayName} reading order`}
    >
      {/* Cover — uses cover-card-lg from globals.css for hover zoom */}
      <div
        className="cover-card-lg"
        style={{
          position:    'relative',
          aspectRatio: '2 / 3',
          borderRadius:'10px',
          overflow:    'hidden',
          background:  '#1a1a2e',
          boxShadow:   '0 2px 12px rgba(0,0,0,0.15)',
          marginBottom:'10px',
        }}
      >
        {/* Letter fallback — always in DOM as base layer */}
        <span
          aria-hidden="true"
          style={{
            position:       'absolute',
            inset:          0,
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            fontSize:       '32px',
            fontWeight:     700,
            color:          'rgba(255,255,255,0.12)',
          }}
        >
          {s.displayName.charAt(0)}
        </span>

        {/* Cover image */}
        {s.heroCoverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={s.heroCoverUrl}
            alt=""
            style={{
              position: 'absolute',
              inset:    0,
              width:    '100%',
              height:   '100%',
              objectFit:'cover',
            }}
            loading="lazy"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        )}
      </div>

      {/* Publisher badge */}
      <p style={{
        fontSize:      '10px',
        fontWeight:    600,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        color:         '#E8272A',
        margin:        '0 0 4px 2px',
        lineHeight:    1.3,
      }}>
        {s.publisher}
      </p>

      {/* Series name */}
      <p style={{
        fontSize:        '13px',
        fontWeight:      700,
        color:           '#0A0A0A',
        lineHeight:      1.3,
        margin:          '0 0 4px 2px',
        display:         '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow:        'hidden',
      }}>
        {s.displayName}
      </p>

      {/* Volume count */}
      <p style={{
        fontSize:   '11px',
        color:      '#6B7280',
        fontWeight: 500,
        margin:     '0 0 0 2px',
      }}>
        {s.volumeCount} {s.volumeCount === 1 ? 'volume' : 'volumes'} · Reading order
      </p>
    </Link>
  )
}

// ── ExploreSeriesSection ───────────────────────────────────────────────────────

export default function ExploreSeriesSection() {
  const [series, setSeries] = useState<FeaturedSeries[]>(SERIES_FALLBACK)

  useEffect(() => {
    fetch('/api/series-preview')
      .then(r => r.json())
      .then((data: { series: FeaturedSeries[] }) => {
        if (data.series?.length > 0) setSeries(data.series)
      })
      .catch(() => { /* keep static fallback */ })
  }, [])

  return (
    <>
      <style>{`
        .explore-series-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
        }
        @media (min-width: 640px) {
          .explore-series-grid {
            grid-template-columns: repeat(6, 1fr);
            gap: 16px;
          }
        }
      `}</style>

      <section
        style={{
          background: '#F8F8F6',
          borderTop:  '1px solid #F0F0F0',
          padding:    '28px 0 40px',
        }}
        aria-labelledby="explore-series-heading"
      >
        <div
          className="max-w-6xl mx-auto"
          style={{ padding: '0 24px' }}
        >

          {/* Section header */}
          <div style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
            marginBottom:   '20px',
            gap:            '16px',
          }}>
            <div>
              <h2
                id="explore-series-heading"
                style={{ fontSize: '15px', fontWeight: 600, color: '#111', margin: 0 }}
              >
                Explore Series
              </h2>
              <p style={{ fontSize: '11px', color: '#6B7280', margin: '2px 0 0' }}>
                Reading journeys — find where to start and what comes next
              </p>
            </div>
            <Link
              href="/series"
              style={{
                fontSize:       '13px',
                fontWeight:     600,
                color:          '#E8272A',
                textDecoration: 'none',
                whiteSpace:     'nowrap',
                flexShrink:     0,
                transition:     'opacity 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.75' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
            >
              Browse all series →
            </Link>
          </div>

          {/* Series grid */}
          <div className="explore-series-grid">
            {series.map(s => (
              <SeriesCard key={s.slug} s={s} />
            ))}
          </div>

        </div>
      </section>
    </>
  )
}
