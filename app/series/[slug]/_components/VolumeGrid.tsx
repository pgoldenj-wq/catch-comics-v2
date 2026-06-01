import VolumeCard from './VolumeCard'
import type { VolumeCardData } from '@/lib/series/types'

interface Props {
  volumes: VolumeCardData[]
  seriesName: string
}

export default function VolumeGrid({ volumes, seriesName }: Props) {
  if (volumes.length === 0) return null

  return (
    <section>
      {/* Section header */}
      <div
        style={{
          display:        'flex',
          alignItems:     'baseline',
          justifyContent: 'space-between',
          marginBottom:   '24px',
        }}
      >
        <h2
          style={{ fontSize: '20px', fontWeight: 700, color: '#0A0A0A', letterSpacing: '-0.01em', margin: 0 }}
        >
          Reading Order
        </h2>
        <span style={{ fontSize: '13px', color: '#6B7280' }}>
          {volumes.length} {volumes.length === 1 ? 'volume' : 'volumes'}
        </span>
      </div>

      {/* Start Here explanation — only shown when there are multiple volumes */}
      {volumes.length > 1 && (
        <p style={{ fontSize: '13px', color: '#6B7280', marginBottom: '20px', lineHeight: 1.5 }}>
          New to <strong style={{ color: '#0A0A0A' }}>{seriesName}</strong>?
          {' '}Start with{' '}
          <strong style={{ color: '#0A0A0A' }}>
            {volumes[0].volumeNumber !== null ? `Vol. ${volumes[0].volumeNumber}` : 'the first volume'}
          </strong>{' '}
          and follow the reading order below.
        </p>
      )}

      {/* Grid — auto-fill responsive, overflow visible for hover effects */}
      <div
        className="grid gap-5"
        style={{
          gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
          overflow:            'visible',
        }}
      >
        {volumes.map(volume => (
          <VolumeCard key={volume.slug} volume={volume} />
        ))}
      </div>
    </section>
  )
}
