import { NextRequest, NextResponse } from 'next/server'
import { searchCache, volumeCache } from '@/lib/cache'
import { parseComicQuery, scoreIssueResult } from '@/lib/parseComicQuery'

// ── Image helpers ─────────────────────────────────────────────────────────────

// Comic Vine stores its "no cover" placeholder under user_id 0 in their CDN.
// Pattern: /uploads/{scale}/0/{object_id}/...
function isPlaceholderImage(url: string | undefined | null): boolean {
  if (!url) return true
  if (url.includes('no_image')) return true
  if (/\/uploads\/[^/]+\/0\/\d+\//.test(url)) return true
  return false
}

function cleanImageUrls(image: { medium_url?: string; original_url?: string } | null | undefined) {
  return {
    medium_url:   isPlaceholderImage(image?.medium_url)   ? '' : (image?.medium_url   ?? ''),
    original_url: isPlaceholderImage(image?.original_url) ? '' : (image?.original_url ?? ''),
  }
}

// ── ISBN detection ────────────────────────────────────────────────────────────

function detectISBN(query: string): string | null {
  const stripped = query.replace(/[\s\-]/g, '')
  if (/^\d{13}$/.test(stripped)) return stripped
  if (/^\d{9}[\dXx]$/.test(stripped)) return stripped
  return null
}

// ── Open Library mapping ──────────────────────────────────────────────────────

function mapOpenLibraryBook(isbn: string, book: Record<string, unknown>) {
  const coverData   = book.cover as Record<string, string> | undefined
  const thumbnail   = coverData?.large || coverData?.medium || coverData?.small
    || `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`
  const authors     = ((book.authors as Array<{ name: string }>) || []).map(a => a.name)
  const publishers  = ((book.publishers as Array<{ name: string }>) || [])
  const identifiers = (book.identifiers as Record<string, string[]>) || {}
  const publishDate = (book.publish_date as string) || ''
  const yearMatch   = publishDate.match(/\b(\d{4})\b/)

  return {
    id: `ol-${isbn}`,
    name: (book.title as string) || 'Unknown Title',
    image: { medium_url: thumbnail, original_url: thumbnail },
    start_year: yearMatch ? yearMatch[1] : '',
    publisher: { name: publishers[0]?.name || '' },
    description: '',
    authors,
    isbn13: (identifiers.isbn_13 || [])[0] || (isbn.length === 13 ? isbn : ''),
    isbn10: (identifiers.isbn_10 || [])[0] || (isbn.length === 10 ? isbn : ''),
    source: 'open_library',
  }
}

// ── Comic Vine result mappers ─────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCVIssue(r: any) {
  const volumeName  = (r.volume?.name as string) || ''
  const issueNum    = (r.issue_number as string) || ''
  const displayName = issueNum
    ? (volumeName ? `${volumeName} #${issueNum}` : `Issue #${issueNum}`)
    : (r.name || volumeName || 'Unknown Issue')
  const coverYear = ((r.cover_date || r.store_date || '') as string).match(/^(\d{4})/)?.[1] || ''

  return {
    id: `i${r.id as number}`,
    name: displayName,
    image: cleanImageUrls(r.image),
    start_year: coverYear,
    publisher: { name: (r.volume?.publisher?.name as string) || '' },
    description: (r.description as string) || '',
    count_of_issues: 1,
    source: 'cv_issue',
  }
}

// Sanitise a raw Comic Vine volume results array: dedup, filter empties and
// variant-cover entries, blank placeholder images.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sanitiseVolumeResults(raw: any[]): any[] {
  const seenIds = new Set<number>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return raw.reduce((acc: any[], r: any) => {
    if (!r.name?.trim()) return acc
    if (seenIds.has(r.id)) return acc
    seenIds.add(r.id)
    if (/\(\s*variant\b/i.test(r.name)) return acc
    if ((r.name as string).toLowerCase().includes('variant cover edition')) return acc
    acc.push({ ...r, image: cleanImageUrls(r.image) })
    return acc
  }, [])
}

// ── Publisher enrichment ──────────────────────────────────────────────────────
// Batch-fetch publisher names for unique volume IDs that issue results reference.
// Results are cached in volumeCache under key "publisher:{id}".
// Limited to 5 unique volumes per request to protect CV rate limits.

async function enrichIssuePublishers(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  issueResults: any[],
  rawIssueData: Array<{ volume?: { id?: number } }>,
  apiKey: string
): Promise<void> {
  const uniqueVolumeIds = [
    ...new Set(
      rawIssueData
        .map(r => r.volume?.id)
        .filter((id): id is number => !!id)
    ),
  ].slice(0, 5)  // guard against large fan-out

  if (uniqueVolumeIds.length === 0) return

  const publisherMap: Record<number, string> = {}

  await Promise.all(
    uniqueVolumeIds.map(async (volId) => {
      const cacheKey = `publisher:${volId}`
      const cached   = volumeCache.get(cacheKey) as string | null
      if (cached !== null) {
        publisherMap[volId] = cached
        return
      }
      try {
        const res  = await fetch(
          `https://comicvine.gamespot.com/api/volume/4050-${volId}/?api_key=${apiKey}&format=json&field_list=id,publisher`,
          { headers: { 'User-Agent': 'CatchComics/1.0' } }
        )
        const data = await res.json()
        const pub  = (data.results?.publisher?.name as string) || ''
        volumeCache.set(cacheKey, pub)
        publisherMap[volId] = pub
      } catch {
        publisherMap[volId] = ''
      }
    })
  )

  // Attach publisher names to issue results
  rawIssueData.forEach((raw, i) => {
    const volId = raw.volume?.id
    if (volId && publisherMap[volId] && issueResults[i]) {
      issueResults[i].publisher = { name: publisherMap[volId] }
    }
  })
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const query        = searchParams.get('q')

  if (!query) {
    return NextResponse.json({ error: 'No search query provided' }, { status: 400 })
  }

  // ── Search cache ──────────────────────────────────────────────────────────
  const searchCacheKey = `search:${query.toLowerCase().trim()}`
  const cachedResult   = searchCache.get(searchCacheKey)
  if (cachedResult) {
    console.log(`[/api/search] cache hit for "${query}"`)
    return NextResponse.json(cachedResult)
  }

  // ── ISBN route (Open Library) ─────────────────────────────────────────────
  const isbn = detectISBN(query)
  if (isbn) {
    console.log(`[/api/search] ISBN detected: ${isbn}`)
    try {
      const olUrl  = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&jscmd=data&format=json`
      const res    = await fetch(olUrl, { headers: { 'User-Agent': 'CatchComics/1.0' } })
      if (!res.ok) return NextResponse.json({ results: [], total: 0 })
      const data   = await res.json() as Record<string, unknown>
      const book   = data[`ISBN:${isbn}`] as Record<string, unknown> | undefined
      if (!book)   return NextResponse.json({ results: [], total: 0 })
      const body   = { results: [mapOpenLibraryBook(isbn, book)], total: 1 }
      searchCache.set(searchCacheKey, body)
      return NextResponse.json(body)
    } catch (err) {
      console.error('[/api/search] Open Library error:', err)
      return NextResponse.json({ results: [], total: 0 })
    }
  }

  // ── Comic Vine search ─────────────────────────────────────────────────────
  const apiKey = process.env.COMIC_VINE_API_KEY
  if (!apiKey) {
    console.error('[/api/search] COMIC_VINE_API_KEY not set')
    return NextResponse.json(
      { error: 'Search is temporarily unavailable. Please try again later.' },
      { status: 500 }
    )
  }

  const parsed  = parseComicQuery(query)
  const encoded = encodeURIComponent(query)
  console.log(`[/api/search] parsed: title="${parsed.cleanTitle}" issue="${parsed.issueNumber}" intent=${parsed.hasIssueIntent}`)

  const volumeUrl = `https://comicvine.gamespot.com/api/search/?api_key=${apiKey}&format=json&resources=volume&query=${encoded}&limit=20&field_list=id,name,image,start_year,publisher,description,count_of_issues`

  try {
    if (!parsed.hasIssueIntent) {
      // ── Volume-only path ─────────────────────────────────────────────────
      const res  = await fetch(volumeUrl, { headers: { 'User-Agent': 'CatchComics/1.0' } })
      const data = await res.json()
      console.log(`[/api/search] CV volume status_code=${data.status_code} count=${Array.isArray(data.results) ? data.results.length : '?'}`)

      if (!res.ok || data.status_code !== 1) {
        return NextResponse.json(
          { error: `Comic Vine error: ${data.error || res.status}` },
          { status: 502 }
        )
      }

      const body = {
        results: sanitiseVolumeResults(data.results || []),
        total:   data.number_of_total_results || 0,
      }
      searchCache.set(searchCacheKey, body)
      return NextResponse.json(body)
    }

    // ── Issue + volume parallel path ─────────────────────────────────────────
    // Run both searches concurrently; issues ranked first.
    const issueUrl = `https://comicvine.gamespot.com/api/search/?api_key=${apiKey}&format=json&resources=issue&query=${encoded}&limit=15&field_list=id,name,image,issue_number,volume,cover_date,store_date,description`

    const [volumeRes, issueRes] = await Promise.all([
      fetch(volumeUrl, { headers: { 'User-Agent': 'CatchComics/1.0' } }),
      fetch(issueUrl,  { headers: { 'User-Agent': 'CatchComics/1.0' } }),
    ])
    const [volumeData, issueData] = await Promise.all([
      volumeRes.json(),
      issueRes.json(),
    ])
    console.log(`[/api/search] CV issue status_code=${issueData.status_code} count=${Array.isArray(issueData.results) ? issueData.results.length : '?'}`)

    // ── Re-rank raw issue results before mapping ──────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawIssues: any[] = (issueData.status_code === 1 && Array.isArray(issueData.results))
      ? issueData.results.filter((r: { id?: number; volume?: unknown }) => r.id && r.volume)
      : []

    // Sort by composite score (issue# match + title match) descending
    rawIssues.sort((a, b) => scoreIssueResult(b, parsed) - scoreIssueResult(a, parsed))

    // Map to frontend shape
    const issueResults = rawIssues.map(mapCVIssue)

    // ── Publisher enrichment (concurrent, cached) ─────────────────────────
    await enrichIssuePublishers(issueResults, rawIssues, apiKey)

    // ── Sanitise volumes; drop any whose series has an issue result ───────
    const issueVolumeIds = new Set(
      rawIssues.map((r: { volume?: { id?: number } }) => r.volume?.id).filter(Boolean)
    )
    const volumeResults = (volumeData.status_code === 1 && Array.isArray(volumeData.results))
      ? sanitiseVolumeResults(volumeData.results).filter(
          (r: { id: number }) => !issueVolumeIds.has(r.id)
        )
      : []

    const combined = [...issueResults, ...volumeResults]
    const body     = { results: combined, total: combined.length }
    searchCache.set(searchCacheKey, body)
    return NextResponse.json(body)

  } catch (err) {
    console.error('[/api/search] Unexpected error:', err)
    return NextResponse.json(
      { error: 'Failed to fetch results. Please try again.' },
      { status: 500 }
    )
  }
}
