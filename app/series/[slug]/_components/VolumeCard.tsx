'use client'

import Link from 'next/link'
import { FORMAT_LABELS } from '@/lib/series/types'
import type { VolumeCardData } from '@/lib/series/types'

interface Props {
  volume: VolumeCardData
}

const CURRENCY: Record<string, string> = { GBP: '£', USD: '$', EUR: '€' }

export default function VolumeCard({ volume }: Props) {
  const {
    slug, title, volumeNumber, format,
    coverUrl, lowestPrice, currency, inStock, isStartHere,
  } = volume

  const sym       = CURRENCY[currency] ?? currency
  const priceText = lowestPrice !== null ? `${sym}${lowestPrice.toFixed(2)}` : null
  const fmtLabel  = FORMAT_LABELS[format] ?? format

  const volLabel = volumeNumber !== null ? `Vol. ${volumeNumber}` : null

  return (
    <Link
      href={`/product/${slug}`}
      className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E8272A] focus-visible:ring-offset-2 rounded-xl"
      aria-label={`${title}${volLabel ? ` — ${volLabel}` : ''}`}
    >
      {/* Cover */}
      <div
        style={{
          position:    'relative',
          aspectRatio: '2 / 3',
          borderRadius:'10px',
          overflow:    'hidden',
          background:  '#1a1a2e',
          boxShadow:   '0 2px 12px rgba(0,0,0,0.15)',
        }}
        className="cover-card-lg"
      >
        {/* Letter fallback */}
        <span
          aria-hidden="true"
          style={{
            position:   'absolute',
            inset:       0,
            display:    'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize:   '24px',
            fontWeight: 600,
            color:      'rgba(255,255,255,0.15)',
          }}
        >
          {title.charAt(0)}
        </span>

        {/* Cover image */}
        {coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverUrl}
            alt=""
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            loading="lazy"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        )}

        {/* START HERE badge */}
        {isStartHere && (
          <div
            style={{
              position:     'absolute',
              top:          '8px',
              left:         '8px',
              background:   '#E8272A',
              color:        '#fff',
              fontSize:     '9px',
              fontWeight:   800,
              letterSpacing:'0.1em',
              textTransform:'uppercase',
              padding:      '3px 8px',
              borderRadius: '999px',
              zIndex:       2,
            }}
          >
            Start Here
          </div>
        )}

        {/* Price badge — bottom-right overlay */}
        {priceText && (
          <div
            style={{
              position:   'absolute',
              bottom:     '8px',
              right:      '8px',
              background: 'rgba(0,0,0,0.72)',
              backdropFilter: 'blur(4px)',
              color:      '#fff',
              fontSize:   '11px',
              fontWeight: 700,
              padding:    '3px 7px',
              borderRadius: '6px',
              zIndex:     2,
            }}
          >
            {priceText}
          </div>
        )}
      </div>

      {/* Metadata below cover */}
      <div style={{ marginTop: '10px', paddingLeft: '2px' }}>
        {/* Volume number */}
        {volLabel && (
          <p style={{ fontSize: '10px', fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '3px' }}>
            {volLabel}
          </p>
        )}

        {/* Title */}
        <p
          style={{
            fontSize:   '12px',
            fontWeight: 600,
            color:      '#0A0A0A',
            lineHeight: 1.3,
            marginBottom: '4px',
            display:    '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow:   'hidden',
          }}
          className="group-hover:text-[#E8272A] transition-colors"
        >
          {title}
        </p>

        {/* Format */}
        <p style={{ fontSize: '10px', color: '#6B7280', fontWeight: 500 }}>
          {fmtLabel}
          {!priceText && (
            <span style={{ color: '#C41F22', marginLeft: '6px' }}>Check price →</span>
          )}
        </p>
      </div>
    </Link>
  )
}
