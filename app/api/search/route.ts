import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const query = searchParams.get('q')

  if (!query) {
    return NextResponse.json({ error: 'No search query provided' }, { status: 400 })
  }

  try {
    const apiKey = process.env.COMIC_VINE_API_KEY

    if (!apiKey) {
      console.error('[/api/search] COMIC_VINE_API_KEY is not set in environment variables')
      return NextResponse.json({ error: 'Search is temporarily unavailable. Please try again later.' }, { status: 500 })
    }

    const cvUrl = `https://comicvine.gamespot.com/api/search/?api_key=${apiKey}&format=json&resources=volume&query=${encodeURIComponent(query)}&limit=20&field_list=id,name,image,start_year,publisher,description`
    console.log(`[/api/search] Fetching: ${cvUrl.replace(apiKey, 'REDACTED')}`)

    const response = await fetch(cvUrl, {
      headers: {
        'User-Agent': 'CatchComics/1.0'
      }
    })

    console.log(`[/api/search] Comic Vine status: ${response.status}`)

    const data = await response.json()
    console.log(`[/api/search] Comic Vine status_code: ${data.status_code}, error: ${data.error}, results count: ${Array.isArray(data.results) ? data.results.length : typeof data.results}`)

    if (!response.ok || data.status_code !== 1) {
      console.error(`[/api/search] Comic Vine error response:`, JSON.stringify(data).slice(0, 500))
      return NextResponse.json(
        { error: `Comic Vine error: ${data.error || response.status}` },
        { status: 502 }
      )
    }

    return NextResponse.json({
      results: data.results || [],
      total: data.number_of_total_results || 0
    })

  } catch (error) {
    console.error('[/api/search] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch results. Please try again.' },
      { status: 500 }
    )
  }
}