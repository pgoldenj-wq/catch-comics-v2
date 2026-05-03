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

  // Reject non-numeric IDs immediately — Open Library IDs (ol-*) are handled
  // client-side and should never reach this route.
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'Invalid comic ID' }, { status: 400 })
  }

  try {
    const apiKey = process.env.COMIC_VINE_API_KEY

    if (!apiKey) {
      console.error('[/api/comic] COMIC_VINE_API_KEY is not set in environment variables')
      return NextResponse.json({ error: 'Service temporarily unavailable.' }, { status: 500 })
    }

    const url = 'https://comicvine.gamespot.com/api/volume/4050-' + id + '/?api_key=' + apiKey + '&format=json&field_list=id,name,image,start_year,publisher,description,count_of_issues'

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'CatchComics/1.0'
      }
    })

    const data = await response.json()

    const comic = (data.results && !Array.isArray(data.results)) ? data.results : null
    // Blank Comic Vine placeholder images so the frontend shows the letter fallback
    if (comic?.image) {
      if (isPlaceholderImage(comic.image.medium_url))   comic.image.medium_url   = ''
      if (isPlaceholderImage(comic.image.original_url)) comic.image.original_url = ''
    }
    return NextResponse.json({ comic })

  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch comic details.' },
      { status: 500 }
    )
  }
}