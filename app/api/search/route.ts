import { NextRequest, NextResponse } from 'next/server'

// Comic Vine stores its "no cover available" placeholder under user_id 0 in their CDN.
// Real cover images always have a non-zero user_id segment after the scale type.
// Pattern: /uploads/{scale}/0/{object_id}/...
function isPlaceholderImage(url: string | undefined | null): boolean {
  if (!url) return true
  if (url.includes('no_image')) return true
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

// Detect single-issue queries: "Batman #1", "Absolute Batman #19", "issue 5"
function detectIssueQuery(query: string): boolean {
  return /#\d+/.test(query) || /\bissue\s+\d+\b/i.test(query)
}

// Map an Open Library book record to the shape the frontend expects
function mapOpenLibraryBook(isbn: string, book: Record<string, unknown>) {
  const coverData = book.cover as Record<string, string> | undefined
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

// Map a Comic Vine issue record to the frontend shape.
// Issues use id prefix "i" to distinguish them from volumes at the detail route.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCVIssue(r: any) {
  const volumeName = (r.volume?.name as string) || ''
  const issueNum   = (r.issue_number as string) || ''
  // Build a human-readable display name
  const displayName = issueNum
    ? (volumeName ? `${volumeName} #${issueNum}` : `Issue #${issueNum}`)
    : (r.name || volumeName || 'Unknown Issue')
  // Extract year from cover_date ("2025-07-01") or store_date
  const coverYear = ((r.cover_date || r.store_date || '') as string).match(/^(\d{4})/)?.[1] || ''
  const midUrl  = isPlaceholderImage(r.image?.medium_url)   ? '' : (r.image?.medium_url   ?? '')
  const origUrl = isPlaceholderImage(r.image?.original_url) ? '' : (r.image?.original_url ?? '')
  return {
    id: `i${r.id}`,
    name: displayName,
    image: { medium_url: midUrl, original_url: origUrl },
    start_year: coverYear,
    publisher: { name: (r.volume?.publisher?.name as string) || '' },
    description: (r.description as string) || '',
    count_of_issues: 1,
    source: 'cv_issue',
  }
}

// Sanitise a raw Comic Vine volume results array: dedup, filter empties and variants,
// blank placeholder images.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sanitiseVolumeResults(raw: any[]): any[] {
  const seenIds = new Set<number>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return raw.reduce((acc: any[], r: any) => {
    if (!r.name?.trim()) return acc
    if (seenIds.has(r.id)) return acc
    seenIds.add(r.id)
    const lname = (r.name as string).toLowerCase()
    if (/\(\s*variant\b/i.test(r.name) || lname.includes('variant cover edition')) return acc
    const midUrl  = isPlaceholderImage(r.image?.medium_url)   ? '' : r.image?.medium_url   ?? ''
    const origUrl = isPlaceholderImage(r.image?.original_url) ? '' : r.image?.original_url ?? ''
    acc.push({ ...r, image: { medium_url: midUrl, original_url: origUrl } })
    return acc
  }, [])
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
      const response = await fetch(olUrl, { headers: { 'User-Agent': 'CatchComics/1.0' } })
      console.log(`[/api/search] Open Library status: ${response.status}`)

      if (!response.ok) {
        console.error('[/api/search] Open Library error:', response.status)
        return NextResponse.json({ results: [], total: 0 })
      }

      const data = await response.json() as Record<string, unknown>
      const book = data[`ISBN:${isbn}`] as Record<string, unknown> | undefined
      if (!book) return NextResponse.json({ results: [], total: 0 })

      return NextResponse.json({ results: [mapOpenLibraryBook(isbn, book)], total: 1 })
    } catch (error) {
      console.error('[/api/search] Open Library unexpected error:', error)
      return NextResponse.json({ results: [], total: 0 })
    }
  }

  // ── COMIC VINE SEARCH ────────────────────────────────────────────────────
  try {
    const apiKey = process.env.COMIC_VINE_API_KEY
    if (!apiKey) {
      console.error('[/api/search] COMIC_VINE_API_KEY is not set')
      return NextResponse.json({ error: 'Search is temporarily unavailable. Please try again later.' }, { status: 500 })
    }

    const encoded = encodeURIComponent(query)
    const isIssueQuery = detectIssueQuery(query)

    console.log(`[/api/search] Comic Vine search: "${query}" isIssue=${isIssueQuery}`)

    const volumeUrl = `https://comicvine.gamespot.com/api/search/?api_key=${apiKey}&format=json&resources=volume&query=${encoded}&limit=20&field_list=id,name,image,start_year,publisher,description,count_of_issues`

    if (!isIssueQuery) {
      // ── Volume-only search (no issue number in query) ───────────────────
      const response = await fetch(volumeUrl, { headers: { 'User-Agent': 'CatchComics/1.0' } })
      console.log(`[/api/search] CV volume status: ${response.status}`)
      const data = await response.json()
      console.log(`[/api/search] CV status_code: ${data.status_code}, count: ${Array.isArray(data.results) ? data.results.length : '?'}`)

      if (!response.ok || data.status_code !== 1) {
        console.error('[/api/search] CV volume error:', JSON.stringify(data).slice(0, 500))
        return NextResponse.json({ error: `Comic Vine error: ${data.error || response.status}` }, { status: 502 })
      }

      return NextResponse.json({
        results: sanitiseVolumeResults(data.results || []),
        total: data.number_of_total_results || 0,
      })
    }

    // ── Issue + volume parallel search (query contains "#N" or "issue N") ─
    // Issues are returned first so exact matches rank above broad volumes.
    const issueUrl = `https://comicvine.gamespot.com/api/search/?api_key=${apiKey}&format=json&resources=issue&query=${encoded}&limit=15&field_list=id,name,image,issue_number,volume,cover_date,store_date,description`

    const [volumeResp, issueResp] = await Promise.all([
      fetch(volumeUrl,  { headers: { 'User-Agent': 'CatchComics/1.0' } }),
      fetch(issueUrl,   { headers: { 'User-Agent': 'CatchComics/1.0' } }),
    ])
    const [volumeData, issueData] = await Promise.all([
      volumeResp.json(),
      issueResp.json(),
    ])
    console.log(`[/api/search] CV issue status_code: ${issueData.status_code}, count: ${Array.isArray(issueData.results) ? issueData.results.length : '?'}`)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const issueResults: any[] = (issueData.status_code === 1 && Array.isArray(issueData.results))
      ? issueData.results
          .filter((r: { id: number; volume?: unknown }) => r.id && r.volume)
          .map(mapCVIssue)
      : []

    const volumeResults = (volumeData.status_code === 1 && Array.isArray(volumeData.results))
      ? sanitiseVolumeResults(volumeData.results)
      : []

    // Issues first, then volumes (dedup volumes whose series already appears as an issue)
    const issueVolumeIds = new Set(
      issueResults.map((r: { name: string }) => {
        const m = r.name.match(/^(.+?)\s+#/)
        return m ? m[1].toLowerCase() : null
      }).filter(Boolean)
    )
    const filteredVolumes = volumeResults.filter(
      (r: { name: string }) => !issueVolumeIds.has(r.name.toLowerCase())
    )

    return NextResponse.json({
      results: [...issueResults, ...filteredVolumes],
      total: issueResults.length + filteredVolumes.length,
    })

  } catch (error) {
    console.error('[/api/search] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to fetch results. Please try again.' }, { status: 500 })
  }
}
