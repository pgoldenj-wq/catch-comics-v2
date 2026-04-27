import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params

  try {
    const apiKey = process.env.COMIC_VINE_API_KEY

    if (!apiKey) {
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
    }

    const url = 'https://comicvine.gamespot.com/api/volume/4050-' + id + '/?api_key=' + apiKey + '&format=json&field_list=id,name,image,start_year,publisher,description,count_of_issues'

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'CatchComics/1.0'
      }
    })

    const data = await response.json()

    return NextResponse.json({
      comic: data.results || null
    })

  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch comic details.' },
      { status: 500 }
    )
  }
}