import { NextRequest, NextResponse } from 'next/server'

// Shared with search route — detect Comic Vine's "no cover" placeholder URLs
function isPlaceholderImage(url: string | undefined | null): boolean {
  if (!url) return true
  if (url.includes('no_image')) return true
  if (/\/uploads\/[^/]+\/0\/\d+\//.test(url)) return true
  return false
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params

  // Accept numeric volume IDs (e.g. "796") or issue IDs prefixed with "i" (e.g. "i892345").
  // Open Library IDs (ol-*) are resolved client-side and never reach this route.
  const isIssue  = /^i\d+$/.test(id)
  const isVolume = /^\d+$/.test(id)

  if (!isIssue && !isVolume) {
    return NextResponse.json({ error: 'Invalid comic ID' }, { status: 400 })
  }

  try {
    const apiKey = process.env.COMIC_VINE_API_KEY
    if (!apiKey) {
      console.error('[/api/comic] COMIC_VINE_API_KEY is not set')
      return NextResponse.json({ error: 'Service temporarily unavailable.' }, { status: 500 })
    }

    const numericId = isIssue ? id.slice(1) : id

    const url = isIssue
      // Comic Vine issue resource prefix is 4000
      ? `https://comicvine.gamespot.com/api/issue/4000-${numericId}/?api_key=${apiKey}&format=json&field_list=id,name,image,issue_number,volume,cover_date,store_date,description`
      // Comic Vine volume resource prefix is 4050
      : `https://comicvine.gamespot.com/api/volume/4050-${numericId}/?api_key=${apiKey}&format=json&field_list=id,name,image,start_year,publisher,description,count_of_issues`

    const response = await fetch(url, { headers: { 'User-Agent': 'CatchComics/1.0' } })
    const data = await response.json()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let comic: any = (data.results && !Array.isArray(data.results)) ? data.results : null

    if (comic && isIssue) {
      // Map issue fields to the volume-like structure the detail page expects
      const volumeName = (comic.volume?.name as string) || ''
      const issueNum   = (comic.issue_number as string) || ''
      const displayName = issueNum
        ? (volumeName ? `${volumeName} #${issueNum}` : `Issue #${issueNum}`)
        : (comic.name || volumeName || 'Unknown Issue')
      const coverYear = ((comic.cover_date || comic.store_date || '') as string).match(/^(\d{4})/)?.[1] || ''
      comic = {
        ...comic,
        name: displayName,
        start_year: coverYear,
        publisher: comic.volume?.publisher || { name: '' },
        count_of_issues: 1,
        source: 'cv_issue',
      }
    }

    // Blank Comic Vine placeholder images so the frontend shows the letter fallback
    if (comic?.image) {
      if (isPlaceholderImage(comic.image.medium_url))   comic.image.medium_url   = ''
      if (isPlaceholderImage(comic.image.original_url)) comic.image.original_url = ''
    }

    return NextResponse.json({ comic })

  } catch (error) {
    console.error('[/api/comic] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to fetch comic details.' }, { status: 500 })
  }
}
