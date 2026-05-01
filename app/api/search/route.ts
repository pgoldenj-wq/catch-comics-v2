import { NextRequest, NextResponse } from 'next/server'

// Detect ISBN-10 or ISBN-13 (tolerates spaces and hyphens)
function detectISBN(query: string): string | null {
  const stripped = query.replace(/[\s\-]/g, '')
  if (/^\d{13}$/.test(stripped)) return stripped          // ISBN-13
  if (/^\d{9}[\dXx]$/.test(stripped)) return stripped     // ISBN-10
  return null
}

// Map a Google Books volume item to the shape the frontend expects
function mapGoogleBooksItem(item: Record<string, unknown>) {
  const info = (item.volumeInfo as Record<string, unknown>) || {}
  const isbns = (info.industryIdentifiers as Array<{ type: string; identifier: string }>) || []
  const isbn13 = isbns.find(i => i.type === 'ISBN_13')?.identifier || ''
  const isbn10 = isbns.find(i => i.type === 'ISBN_10')?.identifier || ''
  const imageLinks = (info.imageLinks as Record<string, string>) || {}
  // Google Books returns http — upgrade to https to avoid mixed-content blocks
  const thumbnail = (imageLinks.thumbnail || imageLinks.smallThumbnail || '').replace('http://', 'https://')
  const authors = (info.authors as string[]) || []
  const publishedDate = (info.publishedDate as string) || ''

  return {
    id: item.id as string,
    name: (info.title as string) || 'Unknown Title',
    image: { medium_url: thumbnail, original_url: thumbnail },
    start_year: publishedDate.slice(0, 4),
    publisher: { name: (info.publisher as string) || '' },
    description: (info.description as string) || '',
    authors,
    isbn13,
    isbn10,
    source: 'google_books',
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const query = searchParams.get('q')

  if (!query) {
    return NextResponse.json({ error: 'No search query provided' }, { status: 400 })
  }

  // ── ISBN SEARCH (Google Books) ────────────────────────────────────────────
  const isbn = detectISBN(query)
  if (isbn) {
    console.log(`[/api/search] ISBN detected: ${isbn} — routing to Google Books`)
    try {
      const gbUrl = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=5`
      const response = await fetch(gbUrl)
      console.log(`[/api/search] Google Books status: ${response.status}`)

      const data = await response.json() as { items?: Record<string, unknown>[]; totalItems?: number }
      console.log(`[/api/search] Google Books totalItems: ${data.totalItems ?? 0}`)

      if (!response.ok) {
        console.error('[/api/search] Google Books error:', response.status)
        return NextResponse.json({ results: [], total: 0 })
      }

      const results = (data.items || []).map(mapGoogleBooksItem)
      return NextResponse.json({ results, total: results.length })

    } catch (error) {
      console.error('[/api/search] Google Books unexpected error:', error)
      return NextResponse.json({ results: [], total: 0 })
    }
  }

  // ── TITLE SEARCH (Comic Vine) ─────────────────────────────────────────────
  try {
    const apiKey = process.env.COMIC_VINE_API_KEY

    if (!apiKey) {
      console.error('[/api/search] COMIC_VINE_API_KEY is not set in environment variables')
      return NextResponse.json({ error: 'Search is temporarily unavailable. Please try again later.' }, { status: 500 })
    }

    console.log(`[/api/search] Title search via Comic Vine: "${query}"`)
    const cvUrl = `https://comicvine.gamespot.com/api/search/?api_key=${apiKey}&format=json&resources=volume&query=${encodeURIComponent(query)}&limit=20&field_list=id,name,image,start_year,publisher,description`

    const response = await fetch(cvUrl, {
      headers: { 'User-Agent': 'CatchComics/1.0' }
    })

    console.log(`[/api/search] Comic Vine status: ${response.status}`)
    const data = await response.json()
    console.log(`[/api/search] Comic Vine status_code: ${data.status_code}, results: ${Array.isArray(data.results) ? data.results.length : typeof data.results}`)

    if (!response.ok || data.status_code !== 1) {
      console.error('[/api/search] Comic Vine error:', JSON.stringify(data).slice(0, 500))
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