/**
 * GET /api/series-preview
 *
 * Returns cover URL and volume count for the 6 featured series displayed in
 * the homepage "Explore Series" section. Revalidated hourly via ISR.
 *
 * Used by: components/ExploreSeriesSection.tsx
 */

import { NextResponse }    from 'next/server'
import { SERIES_REGISTRY } from '@/lib/series/registry'
import { getSeriesData }   from '@/lib/series/getSeriesData'

export const revalidate = 3600

/** Ordered list of slugs to feature on the homepage. */
const FEATURED_SLUGS = [
  'saga',
  'the-walking-dead',
  'invincible',
  'witch-hat-atelier',
  'trigun-maximum-deluxe',
  'hellsing',
] as const

export async function GET() {
  try {
    const featured = await Promise.all(
      FEATURED_SLUGS.map(async slug => {
        const entry = SERIES_REGISTRY[slug]
        if (!entry) return null
        const data = await getSeriesData(entry)
        return {
          slug,
          displayName:  entry.displayName,
          publisher:    entry.publisher,
          heroCoverUrl: data.heroCoverUrl,
          volumeCount:  data.volumes.length,
        }
      })
    )

    return NextResponse.json({
      series: featured.filter(Boolean),
    })
  } catch (err) {
    console.error('[series-preview] DB error:', err)
    return NextResponse.json({ series: [] }, { status: 500 })
  }
}
