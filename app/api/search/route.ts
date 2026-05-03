import { NextRequest, NextResponse } from 'next/server'

// Comic Vine stores its "no cover available" placeholder under user_id 0 in their CDN.
// Real cover images always have a non-zero user_id segment after the scale type.
// Pattern: /uploads/{scale}/0/{object_id}/...
function isPlaceholderImage(url: string | undefined | null): boolean {
  if (!url) return true
  if (url.includes('no_image')) return true
  // Match: .../uploads/<scale>/0/<digits>/... — Comic Vine's system/placeholder ownership
  if (/\/uploads\/[^/]+\/0\/\d+\//.test(url)) return true
  return false
}

// Detect ISBN-10 or ISBN-13 (tolerates spaces and hyphens)
function detectISBN(query: string): string | null {
  const stripped = query.replace(/[\s\-]/g, '')
  if (/^\d{13}$/.test(stripped)) return stripped          // ISBN-13
  if (/^\d{9}[\dXx]$/.test(stripped)) return stripped     // ISBN-10
  return null
}

// Map an Open Library book record to the shape the frontend expects
function mapOpenLibraryBook(isbn: string, book: Record<string, unknown>) {
  const coverData = book.cover as Record<string, string> | undefined
  // Prefer API-provided cover; fall back to the covers CDN direct URL
  const thumbnail = coverData?.large || coverData?.medium || coverData?.small
    || `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`

  const authors = ((book.authors as Array<{ name: string }>) || []).map(a => a.name)
  const publishers = ((book.publishers as Array<{ name: string }>) || [])
  const identifiers = (book.identifiers as Record<string, string[]>) || {}

  const publishDate = (book.publish_date as string) || ''
  const yearMatch = publishDate.match(/\b(\d{4})\b/)
  const start_year = yearMatch ? yearMatch[1] : ''

  return {
    id: `ol-${isbn}`,
    name: (book.title as string) || 'Unknown Title',
    image: { medium_url: thumbnail, original_url: thumbnail },
    start_year,
    publisher: { name: publishers[0]?.name || '' },
    description: '',
    authors,
    isbn13: (identifiers.isbn_13 || [])[0] || (isbn.length === 13 ? isbn : ''),
    isbn10: (identifiers.isbn_10 || [])[0] || (isbn.length === 10 ? isbn : ''),
    source: 'open_library',
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const query = searchParams.get('q')

  if (!query) {
    return NextResponse.json({ error: 'No search query provided' }, { status: 400 })
  }

  // ── ISBN SEARCH (Open Library — no API key, no rate limits) ─────────────
  const isbn = detectISBN(query)
  if (isbn) {
    console.log(`[/api/search] ISBN detected: ${isbn} — routing to Open Library`)
    try {
      const olUrl = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&jscmd=data&format=json`
      const response = await fetch(olUrl, {
        headers: { 'User-Agent': 'CatchComics/1.0' }
      })
      console.log(`[/api/search] Open Library status: ${response.status}`)

      if (!response.ok) {
        console.error('[/api/search] Open Library error:', response.status)
        return NextResponse.json({ results: [], total: 0 })
      }

      const data = await response.json() as Record<string, unknown>
      const book = data[`ISBN:${isbn}`] as Record<string, unknown> | undefined
      console.log(`[/api/search] Open Library found: ${book ? 'yes' : 'no'}`)

      if (!book) {
        return NextResponse.json({ results: [], total: 0 })
      }

      const result = mapOpenLibraryBook(isbn, book)
      return NextResponse.json({ results: [result], total: 1 })

    } catch (error) {
      console.error('[/api/search] Open Library unexpected error:', error)
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
    const cvUrl = `https://comicvine.gamespot.com/api/search/?api_key=${apiKey}&format=json&resources=volume&query=${encodeURIComponent(query)}&limit=20&field_list=id,name,image,start_year,publisher,description,count_of_issues`

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

    // ── Sanitise results ────────────────────────────────────────────────────
    const seenIds = new Set<number>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = (data.results || []).reduce((acc: any[], r: any) => {
      // 1. Skip entries with no name
      if (!r.name?.trim()) return acc
      // 2. Deduplicate by Comic Vine ID
      if (seenIds.has(r.id)) return acc
      seenIds.add(r.id)
      // 3. Filter variant-cover volumes — these are collector label entries,
      //    not independent purchasable books (e.g. "Batman #1 (Variant Cover)")
      const lname = (r.name as string).toLowerCase()
      if (/\(\s*variant\b/i.test(r.name) || lname.includes('variant cover edition')) return acc
      // 4. Blank placeholder image URLs so the frontend shows the letter fallback
      const midUrl = isPlaceholderImage(r.image?.medium_url)   ? '' : r.image?.medium_url   ?? ''
      const origUrl = isPlaceholderImage(r.image?.original_url) ? '' : r.image?.original_url ?? ''
      acc.push({ ...r, image: { medium_url: midUrl, original_url: origUrl } })
      return acc
    }, [])

    return NextResponse.json({
      results,
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