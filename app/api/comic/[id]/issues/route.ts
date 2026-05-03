import { NextRequest, NextResponse } from 'next/server'
import { volumeIssuesCache } from '@/lib/cache'

// Detect Comic Vine's "no cover" placeholder URLs
function isPlaceholderImage(url: string | undefined | null): boolean {
  if (!url) return true
  if (url.includes('no_image')) return true
  if (/\/uploads\/[^/]+\/0\/\d+\//.test(url)) return true
  return false
}

interface RawCVIssue {
  id?: number
  name?: string
  issue_number?: string
  image?: { small_url?: string; medium_url?: string; original_url?: string }
  cover_date?: string
  store_date?: string
}

/**
 * GET /api/comic/{volumeId}/issues
 *
 * Returns ALL issues for a Comic Vine volume, sorted by issue_number ascending.
 *
 * Bypasses the 20-issue cap on the CV /search endpoint by using the dedicated
 * /issues filter endpoint (limit 100). For series with >100 issues we'd need to
 * page; today no series we surface exceeds that.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params

  // This endpoint only handles volumes — issues (i-prefixed) and Open Library
  // results don't have child issues to enumerate.
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'Invalid volume ID' }, { status: 400 })
  }

  const cacheKey = `volumeIssues:${id}`
  const cached   = volumeIssuesCache.get(cacheKey)
  if (cached) {
    console.log(`[/api/comic/${id}/issues] cache hit`)
    return NextResponse.json({ issues: cached })
  }

  const apiKey = process.env.COMIC_VINE_API_KEY
  if (!apiKey) {
    console.error('[/api/comic/issues] COMIC_VINE_API_KEY not set')
    return NextResponse.json({ error: 'Service temporarily unavailable.' }, { status: 500 })
  }

  // CV issues endpoint — filter by volume, sort by issue number ascending
  const url = `https://comicvine.gamespot.com/api/issues/?api_key=${apiKey}&format=json&filter=volume:${id}&sort=cover_date:asc&limit=100&field_list=id,name,issue_number,image,cover_date,store_date`

  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'CatchComics/1.0' } })
    const data     = await response.json()

    if (data.status_code !== 1 || !Array.isArray(data.results)) {
      console.error(`[/api/comic/${id}/issues] CV error status=${data.status_code}`)
      return NextResponse.json({ issues: [] })
    }

    // Map to a compact shape suitable for grid display
    const issues = (data.results as RawCVIssue[])
      .filter(r => r.id != null)
      .map(r => {
        const small  = isPlaceholderImage(r.image?.small_url)  ? '' : (r.image?.small_url  || '')
        const medium = isPlaceholderImage(r.image?.medium_url) ? '' : (r.image?.medium_url || '')
        const year   = (r.cover_date || r.store_date || '').match(/^(\d{4})/)?.[1] || ''
        return {
          id:           r.id!,
          issue_number: r.issue_number || '',
          name:         r.name || '',
          image:        { small_url: small, medium_url: medium },
          cover_year:   year,
          cover_date:   r.cover_date || r.store_date || '',
        }
      })
      // Numeric sort by issue_number where possible (CV's sort is by date which is close but not identical)
      .sort((a, b) => {
        const an = parseFloat(a.issue_number) || 0
        const bn = parseFloat(b.issue_number) || 0
        return an - bn
      })

    volumeIssuesCache.set(cacheKey, issues)
    return NextResponse.json({ issues })

  } catch (err) {
    console.error('[/api/comic/issues] Unexpected error:', err)
    return NextResponse.json({ error: 'Failed to fetch issues.' }, { status: 500 })
  }
}
