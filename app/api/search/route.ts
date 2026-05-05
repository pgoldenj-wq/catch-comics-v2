import { NextRequest, NextResponse } from 'next/server'
import { searchCache, volumeCache } from '@/lib/cache'
import { parseComicQuery, titleMatchScore } from '@/lib/parseComicQuery'

// ── Image helpers ─────────────────────────────────────────────────────────────

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
    type: 'book',
    relevanceScore: 100,
  }
}

// ── Relevance scoring ─────────────────────────────────────────────────────────

// Publishers known to produce non-English editions — demote from results
const FOREIGN_PUBLISHERS = new Set([
  'panini', 'glenat', 'glénat', 'urban comics', 'planeta', 'ivrea',
  'editorial ivrea', 'delcourt', 'soleil', 'dargaud', 'le lombard',
  'lombard', 'humanoides', 'les humanoïdes associés', 'bonelli',
  'sergio bonelli editore', 'editions 12bis', 'dupuis', 'casterman',
  'standaard uitgeverij', 'carlsen', 'ehapa', 'kana', 'tonkam',
])

// Publishers that signal high-quality / major-market results
const MAJOR_PUBLISHERS = new Set([
  'marvel', 'dc comics', 'image comics', 'image', 'dark horse comics', 'dark horse',
  'idw publishing', 'idw', 'boom! studios', 'boom studios', 'oni press',
  'fantagraphics books', 'fantagraphics', 'drawn & quarterly',
  'viz media', 'viz', 'kodansha comics', 'kodansha', 'yen press',
  'seven seas entertainment', 'seven seas', 'tokyopop',
  'square enix manga', 'shueisha', 'vertical', 'titan comics',
  'dynamite entertainment', 'dynamite', 'aftershock comics', 'aftershock',
  'vault comics', 'vault', 'scout comics', 'ahoy comics', 'top shelf productions',
])

function isForeignPublisher(name: string | undefined): boolean {
  const p = (name || '').toLowerCase().trim()
  if (!p) return false
  if (FOREIGN_PUBLISHERS.has(p)) return true
  if (p.startsWith('panini')) return true   // "Panini Comics France", "Panini Verlag", etc.
  if (p.startsWith('glenat') || p.startsWith('glénat')) return true
  return false
}

function isForeignTitle(title: string): boolean {
  return /\((?:french|spanish|german|italian|portuguese|dutch|turkish|greek|polish|korean|chinese|arabic|russian)\s+edition\)/i.test(title)
}

function isMajorPublisher(name: string | undefined): boolean {
  return MAJOR_PUBLISHERS.has((name || '').toLowerCase().trim())
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ParsedQuery = ReturnType<typeof parseComicQuery>

// ── Title normaliser for deduplication ────────────────────────────────────────
// Strips year suffixes "(2024)", punctuation, and collapses whitespace so that
// "Absolute Batman (2024)" and "Absolute Batman (2025)" produce the same key.
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s*\(\d{4}\)\s*/g, ' ')   // remove "(year)" suffixes
    .replace(/[^a-z0-9\s]/g, ' ')       // punctuation → space
    .replace(/\s+/g, ' ')
    .trim()
}

const CURRENT_YEAR = new Date().getFullYear()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scoreVolume(r: any, parsed: ParsedQuery): number {
  const pub = (r.publisher?.name as string) || ''
  if (isForeignPublisher(pub) || isForeignTitle(r.name || '')) return -9999

  // Base: issue-intent queries should be dominated by issue results, not volumes
  let score = parsed.hasIssueIntent ? 5 : 20

  // ── Title similarity (0–50) ─────────────────────────────────────────────
  score += titleMatchScore(r.name || '', parsed.cleanTitle)

  // ── Issue count (0–30, log2 scale) ──────────────────────────────────────
  // Log dampens extreme outliers (713-issue Batman) so recency can still
  // surface current runs. log2(2)≈7, log2(20)≈28, log2(100)→capped at 30.
  const count = (r.count_of_issues as number) || 0
  if (count > 0) score += Math.min(30, Math.round(Math.log2(count + 1) * 7))

  // ── Recency (0–25): each year away from now costs 2 points ──────────────
  const year = parseInt((r.start_year as string) || '0', 10)
  if (year >= 1900) score += Math.max(0, 25 - (CURRENT_YEAR - year) * 2)

  // ── Active-series bonus ──────────────────────────────────────────────────
  // Reward series that started recently AND have more than a handful of issues —
  // this distinguishes ongoing runs from cancelled micro-series.
  if (year >= 2019 && count >= 3) score += 20

  // ── High-demand collector keywords ──────────────────────────────────────
  const nameLower = (r.name as string || '').toLowerCase()
  if      (/\babsolute\b/.test(nameLower))  score += 12
  else if (/\bultimate\b/.test(nameLower))  score += 10
  else if (/\bomnibus\b/.test(nameLower))   score += 8
  else if (/\bdeluxe\b/.test(nameLower))    score += 6

  // ── Publisher quality signal ─────────────────────────────────────────────
  if (isMajorPublisher(pub)) score += 10

  return score
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scoreIssue(r: any, parsed: ParsedQuery): number {
  const pub        = (r.volume?.publisher?.name as string) || ''
  const seriesName = (r.volume?.name as string) || ''
  if (isForeignPublisher(pub) || isForeignTitle(seriesName)) return -9999

  // Base: higher when query clearly targets a specific issue
  let score = parsed.hasIssueIntent ? 60 : 10
  if (parsed.hasIssueIntent && parsed.issueNumber) {
    const resultNum = String(parseInt(r.issue_number || '0', 10))
    if (resultNum === parsed.issueNumber) score += 60
  }
  score += titleMatchScore(seriesName, parsed.cleanTitle)
  if (isMajorPublisher(pub)) score += 10
  return score
}

// ── CV result mappers ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCVVolume(r: any, relevanceScore: number) {
  return {
    id:              r.id as number,
    name:            (r.name as string) || '',
    image:           cleanImageUrls(r.image),
    start_year:      (r.start_year as string) || '',
    publisher:       { name: (r.publisher?.name as string) || '' },
    description:     (r.description as string) || '',
    count_of_issues: (r.count_of_issues as number) || 0,
    source:          'cv_volume',
    type:            'volume',
    relevanceScore,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCVIssue(r: any, relevanceScore: number) {
  const volumeName  = (r.volume?.name as string) || ''
  const issueNum    = (r.issue_number as string) || ''
  const displayName = issueNum
    ? (volumeName ? `${volumeName} #${issueNum}` : `Issue #${issueNum}`)
    : (r.name || volumeName || 'Unknown Issue')
  const coverYear = ((r.cover_date || r.store_date || '') as string).match(/^(\d{4})/)?.[1] || ''

  return {
    id:              `i${r.id as number}`,
    name:            displayName,
    image:           cleanImageUrls(r.image),
    start_year:      coverYear,
    publisher:       { name: (r.volume?.publisher?.name as string) || '' },
    description:     (r.description as string) || '',
    count_of_issues: 1,
    source:          'cv_issue',
    type:            'issue',
    relevanceScore,
  }
}

// ── Publisher enrichment ──────────────────────────────────────────────────────
// Batch-fetch publisher names for unique volume IDs that issue results reference.
// Results are cached in volumeCache. Limited to 5 unique volumes per request.

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
  ].slice(0, 5)

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
  console.log(
    `[/api/search] parsed: title="${parsed.cleanTitle}" issue="${parsed.issueNumber}" vol="${parsed.volumeNumber}" issueIntent=${parsed.hasIssueIntent} volIntent=${parsed.hasVolumeIntent}`
  )

  // Always search BOTH volumes and issues in parallel.
  // Scoring handles ordering: issue intent → issues ranked first; broad intent → volumes first.
  // NOTE: limits are intentionally generous — we do NOT slice the merged results so that
  // every issue survives into the dataset where client-side filters can surface it.
  const volumeUrl = `https://comicvine.gamespot.com/api/search/?api_key=${apiKey}&format=json&resources=volume&query=${encoded}&limit=20&field_list=id,name,image,start_year,publisher,description,count_of_issues`
  const issueUrl  = `https://comicvine.gamespot.com/api/search/?api_key=${apiKey}&format=json&resources=issue&query=${encoded}&limit=20&field_list=id,name,image,issue_number,volume,cover_date,store_date,description`

  try {
    const [volumeRes, issueRes] = await Promise.all([
      fetch(volumeUrl, { headers: { 'User-Agent': 'CatchComics/1.0' } }),
      fetch(issueUrl,  { headers: { 'User-Agent': 'CatchComics/1.0' } }),
    ])
    const [volumeData, issueData] = await Promise.all([
      volumeRes.json(),
      issueRes.json(),
    ])
    console.log(
      `[/api/search] CV volume status=${volumeData.status_code} count=${Array.isArray(volumeData.results) ? volumeData.results.length : '?'} | issue status=${issueData.status_code} count=${Array.isArray(issueData.results) ? issueData.results.length : '?'}`
    )

    // ── Score and deduplicate volumes ─────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawVolumes: any[] = (volumeData.status_code === 1 && Array.isArray(volumeData.results))
      ? volumeData.results
      : []

    const seenVolumeIds = new Set<number>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scoredVolumes: Array<{ r: any; score: number }> = []
    for (const r of rawVolumes) {
      if (!r.name?.trim() || !r.id) continue
      if (seenVolumeIds.has(r.id)) continue
      seenVolumeIds.add(r.id)
      if (/\(\s*variant\b/i.test(r.name)) continue
      if ((r.name as string).toLowerCase().includes('variant cover edition')) continue
      const score = scoreVolume(r, parsed)
      if (score <= -9999) continue   // foreign — drop
      scoredVolumes.push({ r, score })
    }

    // ── Score and deduplicate issues ──────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawIssues: any[] = (issueData.status_code === 1 && Array.isArray(issueData.results))
      ? issueData.results.filter((r: { id?: number; volume?: unknown }) => r.id && r.volume)
      : []

    const seenIssueIds = new Set<number>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scoredIssues: Array<{ r: any; score: number }> = []
    for (const r of rawIssues) {
      if (seenIssueIds.has(r.id)) continue
      seenIssueIds.add(r.id)
      const score = scoreIssue(r, parsed)
      if (score <= -9999) continue   // foreign — drop
      scoredIssues.push({ r, score })
    }

    // ── Title-level deduplication ─────────────────────────────────────────
    // Group volumes by normalised title; keep only the highest-scoring
    // representative per group. This collapses near-duplicate API entries
    // such as "Absolute Batman (2024, 19 issues)" + "Absolute Batman (2025,
    // 2 issues)" into ONE result — the 2024 series, which scores higher due
    // to its larger issue count and active-series bonus.
    //
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const titleBestMap = new Map<string, { r: any; score: number }>()
    for (const item of scoredVolumes) {
      // Include publisher in the key so "Batman (DC)" and "Batman (Panini)" are
      // treated as distinct series rather than collapsed into one entry.
      const pubName  = ((item.r.publisher?.name as string) || '').toLowerCase().trim()
      const key      = normalizeTitle((item.r.name as string) || '') + '|' + pubName
      const existing = titleBestMap.get(key)
      if (!existing || item.score > existing.score) {
        titleBestMap.set(key, item)
      }
    }
    const dedupedVolumes = Array.from(titleBestMap.values())
    console.log(
      `[/api/search] dedup: ${scoredVolumes.length} volumes → ${dedupedVolumes.length} after title dedup`
    )

    // ── Map to frontend shape ─────────────────────────────────────────────
    const volumeResults = dedupedVolumes.map(({ r, score }) => mapCVVolume(r, score))
    const issueResults  = scoredIssues.map(({ r, score }) => mapCVIssue(r, score))

    // ── Publisher enrichment for issues (concurrent, cached) ──────────────
    await enrichIssuePublishers(issueResults, scoredIssues.map(({ r }) => r), apiKey)

    // ── Merge and sort by relevanceScore descending ───────────────────────
    // IMPORTANT: Do NOT slice here. Every issue result must survive into the
    // response payload so client-side filters (Single Issues, etc.) have data
    // to work with. Without this, broad queries fill all slots with volumes
    // and the Single Issues filter returns empty results.
    const combined = [...volumeResults, ...issueResults]
      .sort((a, b) => b.relevanceScore - a.relevanceScore)

    const body = { results: combined, total: combined.length }
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
