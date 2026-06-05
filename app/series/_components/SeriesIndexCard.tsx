'use client'

import Link from 'next/link'

interface Props {
  slug:        string
  displayName: string
  publisher:   string
  heroCoverUrl: string | null
  volumeCount: number
}

export default function SeriesIndexCard({ slug, displayName, publisher, heroCoverUrl, volumeCount }: Props) {
  return (
    <Link
      href={`/series/${slug}`}
      className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E8272A] focus-visible:ring-offset-2 rounded-xl"
      aria-label={`${displayName} reading order`}
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
          {displayName.charAt(0)}
        </span>

        {/* Cover image */}
        {heroCoverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroCoverUrl}
            alt=""
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            loading="lazy"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        )}
      </div>

      {/* Metadata */}
      <div style={{ marginTop: '10px', paddingLeft: '2px' }}>
        <p style={{
          fontSize: '10px', fontWeight: 600, textTransform: 'uppercase',
          letterSpacing: '0.1em', color: '#E8272A', marginBottom: '4px',
        }}>
          {publisher}
        </p>

        <p style={{
          fontSize: '13px', fontWeight: 700, color: '#0A0A0A',
          lineHeight: 1.3, marginBottom: '4px',
          display: '-webkit-box', WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}
          className="group-hover:text-[#E8272A] transition-colors"
        >
          {displayName}
        </p>

        <p style={{ fontSize: '11px', color: '#6B7280', fontWeight: 500 }}>
          {volumeCount} {volumeCount === 1 ? 'volume' : 'volumes'} &middot; Reading order
        </p>
      </div>
    </Link>
  )
}
