/**
 * enrich-cv-covers.ts — Comic Vine Cover Enrichment
 *
 * Populates `coverImageUrl` and `comicvineId` on canonical products using the
 * Comic Vine API.  Comic Vine is the highest-priority image source for comics
 * and OVERWRITES existing Google Books / Open Library covers, which frequently
 * serve placeholder images indistinguishable from real covers.
 *
 * ── Source priority ───────────────────────────────────────────────────────────
 *   1. Comic Vine  (this script)       ← best for comics
 *   2. Open Library                    ← decent fallback
 *   3. Retailer/AWIN image             ← last resort
 *   4. Designed fallback               ← shown when nothing else works
 *
 * ── Product selection (default) ──────────────────────────────────────────────
 *   Priority 1  coverImageUrl IS NULL                           — needs a cover
 *   Priority 2  coverImageUrl LIKE '%books.google.com%'         — GB placeholder risk
 *   (add --include-ol to also overwrite Open Library covers)
 *
 * ── CV search strategy ────────────────────────────────────────────────────────
 *   1. Title search → /api/search/ resources=volume    (TPBs, series)
 *   2. Title search → /api/search/ resources=issue     (single issues)
 *   Best-scoring result above MIN_SCORE is used.
 *   Publisher match and title similarity drive scoring.
 *
 * ── Rate limiting ─────────────────────────────────────────────────────────────
 *   Comic Vine public API: ~200 req/hour safe limit.
 *   This script sleeps 1 500 ms between requests — ~2 400 req/hour capacity,
 *   capped by --limit so a single run is well within policy.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *   npm run enrich:cv:covers                         # dry-run, 50 products
 *   npm run enrich:cv:covers -- --limit 20           # dry-run, 20 products
 *   npm run enrich:cv:covers -- --include-ol         # also overwrite OL covers
 *   npm run enrich:cv:covers -- --write              # commit to DB
 *   npm run enrich:cv:covers -- --write --limit 200  # large write batch
 */

import { prisma } from '../lib/prisma'
import { titleMatchScore } from '../lib/parseComicQuery'
import { downloadAndStoreCover } from '../lib/images/download'

// ── CLI args ──────────────────────────────────────────────────────────────────

const args       = process.argv.slice(2)
const WRITE_MODE = args.includes('--write')
const INCLUDE_OL = args.includes('--include-ol')  // also overwrite OL covers

const limitArg = args.indexOf('--limit')
const LIMIT = limitArg !== -1 && !isNaN(Number(args[limitArg + 1]))
  ? parseInt(args[limitArg + 1], 10)
  : 50

// ── Config ────────────────────────────────────────────────────────────────────

const CV_API_KEY    = process.env.COMIC_VINE_API_KEY
const CV_BASE       = 'https://comicvine.gamespot.com/api'
const RATE_LIMIT_MS = 1_500   // 1.5 s between CV requests — well within 200/hr
const MIN_SCORE     = 35      // minimum title-match + publisher score to accept

// ── Types ─────────────────────────────────────────────────────────────────────

interface CVImage {
  icon_url?:   string
  medium_url?: string
  screen_url?: string
  small_url?:  string
  super_url?:  string
  thumb_url?:  string
  tiny_url?:   string
}

interface CVVolumeResult {
  id:               number
  name:             string
  image?:           CVImage
  publisher?:       { name?: string } | null
  start_year?:      string | null
  count_of_issues?: number
}

interface CVIssueResult {
  id:           number
  name?:        string
  issue_number?: string
  image?:       CVImage
  volume?:      { id?: number; name?: string; publisher?: { name?: string } }
  cover_date?:  string
}

interface CVSearchResponse<T> {
  status_code:              number
  error:                    string
  number_of_total_results:  number
  results:                  T[]
}

interface ProductRow {
  id:            string
  title:         string
  isbn13:        string | null
  publisher:     string | null
  format:        string
  coverImageUrl: string | null
  comicvineId:   string | null
}

// ── Stats ─────────────────────────────────────────────────────────────────────

const stats = {
  processed: 0,
  matched:   0,
  noMatch:   0,
  skipped:   0,   // placeholder/invalid CV cover returned
  errors:    0,
  written:   0,
}

// ── Rate limiter ──────────────────────────────────────────────────────────────

let lastRequestAt = 0

async function throttle(): Promise<void> {
  const elapsed = Date.now() - lastRequestAt
  const wait    = RATE_LIMIT_MS - elapsed
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastRequestAt = Date.now()
}

// ── CV image validation ───────────────────────────────────────────────────────

/**
 * Returns true when the URL is a Comic Vine system placeholder rather than a
 * real cover.  CV placeholder URLs contain "/0/" in the uploads path (user-id
 * 0 = CV system account) or include "no_image" in the filename.
 */
function isCVPlaceholder(url: string | undefined | null): boolean {
  if (!url) return true
  if (!url.startsWith('http')) return true
  if (url.includes('no_image'))             return true
  if (/\/uploads\/[^/]+\/0\/\d+\//.test(url)) return true  // system-account uploads
  return false
}

/**
 * Pick the best available image URL from a CV image object.
 * Prefers super_url (largest) → screen_url → medium_url → small_url.
 */
function bestCVImageUrl(image: CVImage | undefined | null): string | null {
  if (!image) return null
  const url = image.super_url ?? image.screen_url ?? image.medium_url ?? image.small_url ?? null
  if (isCVPlaceholder(url)) return null
  return url ?? null
}

// ── Publisher normalisation (for scoring) ─────────────────────────────────────

function normPublisher(name: string | undefined | null): string {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
}

function publisherMatch(dbPublisher: string | null, cvPublisher: string | undefined | null): number {
  if (!dbPublisher || !cvPublisher) return 0
  const a = normPublisher(dbPublisher)
  const b = normPublisher(cvPublisher)
  if (!a || !b) return 0
  if (a === b)              return 20   // exact
  if (a.includes(b) || b.includes(a)) return 12   // substring
  // common abbreviations
  const abbrev: Record<string, string> = {
    'dc comics': 'dc', 'image comics': 'image', 'dark horse comics': 'dark horse',
    'viz media': 'viz', 'kodansha comics': 'kodansha',
    'seven seas entertainment': 'seven seas',
    'idw publishing': 'idw', 'boom! studios': 'boom studios',
  }
  const aShort = abbrev[a] ?? a
  const bShort = abbrev[b] ?? b
  if (aShort === bShort) return 15
  return 0
}

// ── Title cleaning for CV query ───────────────────────────────────────────────

/**
 * Strip volume/series indicators that confuse CV's title search.
 * e.g. "One Piece Volume 24" → "One Piece"
 *       "Absolute Batman Vol 1 The Zoo" → "Absolute Batman"
 */
function cleanTitleForCV(title: string): string {
  return title
    .replace(/\s+vol(?:ume)?\s*\d+.*/i, '')  // "Vol 1", "Volume 3 ..."
    .replace(/\s+#\d+.*/,             '')     // "#12 ..."
    .replace(/\s+issue\s*\d+.*/i,     '')     // "issue 5 ..."
    .replace(/\s+part\s*\d+.*/i,      '')     // "part 2 ..."
    .replace(/\([^)]*\)\s*$/,         '')     // trailing "(2024)" etc.
    .trim()
}

// ── CV API fetch ──────────────────────────────────────────────────────────────

async function cvSearch<T>(
  resource: 'volume' | 'issue',
  query: string,
  fieldList: string,
): Promise<T[]> {
  if (!CV_API_KEY) throw new Error('COMIC_VINE_API_KEY not set in .env.local')

  await throttle()

  const url = new URL(`${CV_BASE}/search/`)
  url.searchParams.set('api_key',    CV_API_KEY)
  url.searchParams.set('format',     'json')
  url.searchParams.set('query',      query)
  url.searchParams.set('resources',  resource)
  url.searchParams.set('field_list', fieldList)
  url.searchParams.set('limit',      '5')   // top 5 per resource, we re-score locally

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'CatchComics/1.0 (hello@catchcomics.com)' },
    signal: AbortSignal.timeout(10_000),
  })

  if (res.status === 429) {
    throw new Error('CV 429 — rate limited. Wait before retrying.')
  }

  if (!res.ok) {
    throw new Error(`CV API ${res.status} for query "${query}"`)
  }

  const body = await res.json() as CVSearchResponse<T>

  if (body.status_code !== 1) {
    // status_code 100 = invalid API key, 101 = object not found, etc.
    throw new Error(`CV API error ${body.status_code}: ${body.error}`)
  }

  return body.results ?? []
}

// ── Score a volume result ─────────────────────────────────────────────────────

function scoreVolume(result: CVVolumeResult, cleanTitle: string, dbPublisher: string | null): number {
  let score = titleMatchScore(result.name, cleanTitle)

  // Publisher match bonus
  score += publisherMatch(dbPublisher, result.publisher?.name)

  // Issue count signal — prefer active series over stubs
  const count = result.count_of_issues ?? 0
  if (count > 0) score += Math.min(15, Math.round(Math.log2(count + 1) * 3))

  // Keyword bonus: collectors' editions that CV tends to have well
  const nameLower = result.name.toLowerCase()
  if (/\babsolute\b/.test(nameLower))  score += 8
  else if (/\bomnibus\b/.test(nameLower)) score += 5
  else if (/\bdeluxe\b/.test(nameLower))  score += 4

  return score
}

function scoreIssue(result: CVIssueResult, cleanTitle: string, dbPublisher: string | null): number {
  const seriesName = result.volume?.name ?? result.name ?? ''
  let score = titleMatchScore(seriesName, cleanTitle)
  score += publisherMatch(dbPublisher, result.volume?.publisher?.name)
  return score
}

// ── Per-product enrichment ────────────────────────────────────────────────────

interface MatchResult {
  cvId:       string   // "4050-12345" (volume) or "4000-99999" (issue)
  coverUrl:   string
  matchName:  string
  publisher:  string
  score:      number
  resource:   'volume' | 'issue'
}

async function findCVCover(product: ProductRow): Promise<MatchResult | null> {
  const rawTitle   = product.title
  const cleanTitle = cleanTitleForCV(rawTitle)
  const isSingle   = product.format === 'SINGLE_ISSUE'

  // ── Volume search (always — even for single issues we search volume first) ──
  let bestVolume: { result: CVVolumeResult; score: number } | null = null
  try {
    const volumes = await cvSearch<CVVolumeResult>(
      'volume',
      cleanTitle,
      'id,name,image,publisher,start_year,count_of_issues',
    )
    for (const v of volumes) {
      const s = scoreVolume(v, cleanTitle, product.publisher)
      if (!bestVolume || s > bestVolume.score) bestVolume = { result: v, score: s }
    }
  } catch (err) {
    // Non-fatal — fall through to issue search
    console.warn(`    ⚠ volume search failed: ${(err as Error).message}`)
  }

  // ── Issue search (for single issues, or if volume score is low) ───────────
  let bestIssue: { result: CVIssueResult; score: number } | null = null
  const volumeIsStrong = (bestVolume?.score ?? 0) >= MIN_SCORE + 10
  if (isSingle || !volumeIsStrong) {
    try {
      const issues = await cvSearch<CVIssueResult>(
        'issue',
        cleanTitle,
        'id,name,image,volume,issue_number,cover_date',
      )
      for (const iss of issues) {
        const s = scoreIssue(iss, cleanTitle, product.publisher)
        if (!bestIssue || s > bestIssue.score) bestIssue = { result: iss, score: s }
      }
    } catch (err) {
      console.warn(`    ⚠ issue search failed: ${(err as Error).message}`)
    }
  }

  // ── Pick better of the two ────────────────────────────────────────────────
  const volScore   = bestVolume?.score ?? -1
  const issueScore = bestIssue?.score  ?? -1

  if (volScore < MIN_SCORE && issueScore < MIN_SCORE) return null

  if (volScore >= issueScore && bestVolume) {
    const coverUrl = bestCVImageUrl(bestVolume.result.image)
    if (!coverUrl) return null
    return {
      cvId:      `4050-${bestVolume.result.id}`,
      coverUrl,
      matchName: bestVolume.result.name,
      publisher: bestVolume.result.publisher?.name ?? '',
      score:     volScore,
      resource:  'volume',
    }
  }

  if (bestIssue) {
    const coverUrl = bestCVImageUrl(bestIssue.result.image)
    if (!coverUrl) return null
    const seriesName = bestIssue.result.volume?.name ?? bestIssue.result.name ?? ''
    return {
      cvId:      `4000-${bestIssue.result.id}`,
      coverUrl,
      matchName: seriesName + (bestIssue.result.issue_number ? ` #${bestIssue.result.issue_number}` : ''),
      publisher: bestIssue.result.volume?.publisher?.name ?? '',
      score:     issueScore,
      resource:  'issue',
    }
  }

  return null
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function selectProducts(limit: number): Promise<ProductRow[]> {
  // Build OR conditions for the cover source filter.
  // Always: null covers + Google Books (placeholder risk).
  // With --include-ol: also overwrite Open Library covers.
  const coverOrConditions: Array<{ coverImageUrl: null | { contains: string } }> = [
    { coverImageUrl: null },
    { coverImageUrl: { contains: 'books.google.com' } },
  ]
  if (INCLUDE_OL) {
    coverOrConditions.push({ coverImageUrl: { contains: 'covers.openlibrary.org' } })
  }

  // Three separate ordered queries — null first, then GB, then OL.
  // Prisma findMany doesn't support CASE-based ordering or subquery ordering,
  // so we fetch each bucket separately and merge, capping at `limit` total.

  // Exclude 'OTHER' format — those are non-comics or unclassified junk.
  // Comic Vine has no data for them and we'd waste API quota.
  const baseWhere = {
    deletedAt:   null,
    comicvineId: null,
    format:      { not: 'OTHER' as const },
  }
  const selectFields = {
    id: true, title: true, isbn13: true, publisher: true,
    format: true, coverImageUrl: true, comicvineId: true,
  } as const

  // Order by listing count descending so products that actually appear on the
  // site (have retailer listings) are enriched first.
  const byListings = { listings: { _count: 'desc' as const } }

  // Bucket 1: null covers (highest priority — definitely need filling)
  const nullBucket = await prisma.canonicalProduct.findMany({
    where:   { ...baseWhere, coverImageUrl: null },
    select:  selectFields,
    orderBy: byListings,
    take:    limit,
  })

  const remaining1 = limit - nullBucket.length
  if (remaining1 <= 0) return nullBucket as ProductRow[]

  // Bucket 2: Google Books covers (overwrite — placeholder images)
  const gbBucket = await prisma.canonicalProduct.findMany({
    where:   { ...baseWhere, coverImageUrl: { contains: 'books.google.com' } },
    select:  selectFields,
    orderBy: byListings,
    take:    remaining1,
  })

  const combined = [...nullBucket, ...gbBucket] as ProductRow[]
  const remaining2 = limit - combined.length
  if (remaining2 <= 0 || !INCLUDE_OL) return combined

  // Bucket 3 (--include-ol only): Open Library covers
  const olBucket = await prisma.canonicalProduct.findMany({
    where:   { ...baseWhere, coverImageUrl: { contains: 'covers.openlibrary.org' } },
    select:  selectFields,
    orderBy: byListings,
    take:    remaining2,
  })

  return [...combined, ...olBucket as ProductRow[]]
}

async function writeEnrichment(productId: string, cvId: string, coverUrl: string): Promise<void> {
  await prisma.canonicalProduct.update({
    where: { id: productId },
    data:  { comicvineId: cvId, coverImageUrl: coverUrl },
  })
}

// ── Source label for display ──────────────────────────────────────────────────

function sourceLabel(coverImageUrl: string | null): string {
  if (!coverImageUrl)                              return 'null'
  if (coverImageUrl.includes('books.google.com')) return 'Google Books'
  if (coverImageUrl.includes('covers.openlibrary.org')) return 'Open Library'
  if (coverImageUrl.includes('productserve'))     return 'Retailer (AWIN)'
  return 'other'
}

// ── Neon wake-up ─────────────────────────────────────────────────────────────
// Neon free tier auto-suspends after 5 min inactivity. The first connection
// after the hourly sleep may hit a suspended endpoint. We retry up to 3 times
// with a 10-second gap — enough time for Neon's cold-start (~3–5 s).

async function wakeDb(maxAttempts = 3, delayMs = 10_000): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`
      if (attempt > 1) console.log(`  ✓ DB connected (attempt ${attempt})`)
      return
    } catch (err) {
      if (attempt === maxAttempts) throw err
      console.log(`  ⚠ DB not ready (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs / 1000}s…`)
      await new Promise(r => setTimeout(r, delayMs))
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!CV_API_KEY) {
    console.error('✗ COMIC_VINE_API_KEY is not set in .env.local')
    process.exit(1)
  }

  console.log('')
  console.log('══════════════════════════════════════════════════════════')
  console.log(' Comic Vine — Cover Enrichment')
  console.log(` Mode       : ${WRITE_MODE ? 'WRITE (saving to DB)' : 'DRY-RUN (pass --write to save)'}`)
  console.log(` Limit      : ${LIMIT}`)
  console.log(` Sources    : null + Google Books${INCLUDE_OL ? ' + Open Library' : ''}`)
  console.log(` Min score  : ${MIN_SCORE}`)
  console.log(' Rate limit : 1.5 s / request')
  console.log('══════════════════════════════════════════════════════════')
  console.log('')

  // Wake Neon if it auto-suspended during the hourly sleep
  await wakeDb()

  const products = await selectProducts(LIMIT)

  if (products.length === 0) {
    console.log('  No products to enrich in this batch.')
    console.log('  (All eligible products may already have Comic Vine data, or')
    console.log('   try --include-ol to also overwrite Open Library covers.)')
    await prisma.$disconnect()
    return
  }

  // Quick source breakdown
  const bySource = new Map<string, number>()
  for (const p of products) {
    const src = sourceLabel(p.coverImageUrl)
    bySource.set(src, (bySource.get(src) ?? 0) + 1)
  }
  console.log(`  Selected ${products.length} products:`)
  for (const [src, n] of bySource) {
    console.log(`    ${n.toString().padStart(5)}  ${src}`)
  }
  console.log('')

  // ── Process each product ───────────────────────────────────────────────────
  for (let i = 0; i < products.length; i++) {
    const p      = products[i]
    const prefix = `[${String(i + 1).padStart(3)}/${products.length}]`

    // Truncate title for display
    const displayTitle = p.title.length > 55 ? p.title.slice(0, 52) + '…' : p.title
    const isbnStr      = p.isbn13 ? `  ISBN ${p.isbn13}` : ''
    console.log(`  ${prefix} ${displayTitle}${isbnStr}`)
    console.log(`           source: ${sourceLabel(p.coverImageUrl)}`)

    stats.processed++

    let match: MatchResult | null = null
    try {
      match = await findCVCover(p)
    } catch (err) {
      const msg = (err as Error).message
      if (msg.includes('429')) {
        console.error('  ✗ CV rate-limited — aborting run. Wait before retrying.')
        break
      }
      console.warn(`    ✗ error: ${msg}`)
      stats.errors++
      continue
    }

    if (!match) {
      console.log(`    ✗ no CV match above score ${MIN_SCORE}`)
      stats.noMatch++
      console.log('')
      continue
    }

    console.log(`    ✓ matched: "${match.matchName}"${match.publisher ? ` (${match.publisher})` : ''} [${match.resource}] score=${match.score}`)
    console.log(`      cvId   : ${match.cvId}`)
    console.log(`      cover  : ${match.coverUrl}`)

    if (WRITE_MODE) {
      try {
        await writeEnrichment(p.id, match.cvId, match.coverUrl)
        console.log(`      → saved`)
        stats.written++
        // Non-blocking R2 upload — self-host the cover immediately after writing to DB
        downloadAndStoreCover(p.id, match.coverUrl)
          .catch(err => console.warn(`      ⚠ R2 upload failed: ${(err as Error).message}`))
      } catch (err) {
        console.warn(`      ✗ DB write failed: ${(err as Error).message}`)
        stats.errors++
      }
    } else {
      console.log(`      → (dry-run: would save)`)
    }

    stats.matched++
    console.log('')
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('── Summary ──────────────────────────────────────────────')
  console.log(`  Processed : ${stats.processed}`)
  console.log(`  Matched   : ${stats.matched}  (${Math.round(stats.matched / Math.max(stats.processed, 1) * 100)}%)`)
  console.log(`  No match  : ${stats.noMatch}  (${Math.round(stats.noMatch  / Math.max(stats.processed, 1) * 100)}%)`)
  console.log(`  Errors    : ${stats.errors}`)
  if (WRITE_MODE) {
    console.log(`  Written   : ${stats.written}`)
  } else {
    console.log(`  Would write: ${stats.matched}`)
    console.log('')
    console.log(`  Run with --write to save changes.`)
  }
  console.log('══════════════════════════════════════════════════════════')
  console.log('')

  await prisma.$disconnect()
}

main().catch(err => {
  console.error('Fatal:', err)
  prisma.$disconnect()
  process.exit(1)
})
