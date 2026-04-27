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
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
    }

    const response = await fetch(
      `https://comicvine.gamespot.com/api/search/?api_key=${apiKey}&format=json&resources=volume&query=${encodeURIComponent(query)}&limit=20&field_list=id,name,image,start_year,publisher,description`,
      {
        headers: {
          'User-Agent': 'CatchComics/1.0'
        }
      }
    )

    if (!response.ok) {
      throw new Error('Comic Vine API error')
    }

    const data = await response.json()

    return NextResponse.json({
      results: data.results || [],
      total: data.number_of_total_results || 0
    })

  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch results. Please try again.' },
      { status: 500 }
    )
  }
}