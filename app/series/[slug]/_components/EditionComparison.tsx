import Link from 'next/link'
import { FORMAT_DESCRIPTORS } from '@/lib/series/types'
import type { EditionGroup } from '@/lib/series/types'

interface Props {
  groups: EditionGroup[]
}

const CURRENCY: Record<string, string> = { GBP: '£', USD: '$', EUR: '€' }

export default function EditionComparison({ groups }: Props) {
  if (groups.length === 0) return null

  return (
    <section style={{ marginTop: '48px' }}>
      <h2
        style={{ fontSize: '20px', fontWeight: 700, color: '#0A0A0A', letterSpacing: '-0.01em', marginBottom: '8px' }}
      >
        Edition Comparison
      </h2>
      <p style={{ fontSize: '13px', color: '#6B7280', marginBottom: '24px' }}>
        Some volumes are available in multiple formats. Compare to find the right edition for you.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {groups.map((group, gi) => (
          <div
            key={gi}
            style={{
              background:   '#fff',
              border:       '1px solid #F0F0F0',
              borderRadius: '16px',
              padding:      '20px',
              boxShadow:    '0 1px 4px rgba(0,0,0,0.05)',
            }}
          >
            <p style={{ fontSize: '12px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '14px' }}>
              {group.volumeNumber !== null ? `Vol. ${group.volumeNumber}` : 'Collected Edition'} — available in {group.editions.length} formats
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              {group.editions.map(edition => {
                const sym     = CURRENCY[edition.currency] ?? edition.currency
                const price   = edition.lowestPrice !== null ? `${sym}${edition.lowestPrice.toFixed(2)}` : 'Check price'
                const desc    = FORMAT_DESCRIPTORS[edition.format] ?? ''
                return (
                  <Link
                    key={edition.slug}
                    href={`/product/${edition.slug}`}
                    style={{
                      display:        'flex',
                      flexDirection:  'column',
                      gap:            '4px',
                      padding:        '12px 16px',
                      border:         `1px solid ${edition.inStock ? '#E5E7EB' : '#F3F4F6'}`,
                      borderRadius:   '12px',
                      textDecoration: 'none',
                      minWidth:       '160px',
                      flex:           '1 1 160px',
                      maxWidth:       '220px',
                      background:     edition.inStock ? '#fff' : '#FAFAFA',
                      transition:     'border-color 0.15s, box-shadow 0.15s',
                    }}
                    onMouseEnter={undefined}
                  >
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#0A0A0A' }}>
                      {edition.formatLabel}
                    </span>
                    {desc && (
                      <span style={{ fontSize: '11px', color: '#6B7280', lineHeight: 1.4 }}>
                        {desc}
                      </span>
                    )}
                    <span style={{ fontSize: '14px', fontWeight: 700, color: edition.lowestPrice !== null ? '#C41F22' : '#9CA3AF', marginTop: '4px' }}>
                      {price}
                    </span>
                    {!edition.inStock && (
                      <span style={{ fontSize: '10px', color: '#9CA3AF' }}>Out of stock</span>
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
