/**
 * enrich-catalogue-cv — Match existing retailer-fed canonical_products
 *                       to their Comic Vine record + populate metadata.
 *
 * Background: ~45,762 of 46k canonical_products came from ISBN-matched
 * retailer feeds with no Comic Vine link. Their pages are thin, covers
 * inconsistent, and the issue-grid right column never renders. This
 * script closes that gap.
 *
 * For each product (priority: no cover first, then thin data):
 *   1. Search Comic Vine /api/search?query={title}&resources=volume
 *      using a title built from series_name OR title (cleaned)
 *   2. Apply F1 word-overlap similarity scoring (mirrors
 *      app/api/comic/search/route.ts) — reject below threshold 0.5
 *   3. Among candidates clearing the threshold, prefer ones whose
 *      publisher matches our DB publisher (case-insensitive contains)
 *      and whose start_year is sensible (>= 1900). Then most issues.
 *   4. On confident match:
 *        - Set comicvine_id (the VOLUME id)
 *        - Populate cv_metadata: cv_volume_id, start_year, publisher,
 *          synopsis (description), creators, characters, ingested_at
 *        - Source cover via downloadAndStoreCoverWithFallback if missing
 *        - Improve series_name if blank
 *        - Improve publisher if blank
 *        - Improve description if blank
 *   5. On no confident match: log as unmatched, leave product unchanged.
 *
 * Rate limit: 1 request / 18 s = ~200/hr. CV's documented cap is 200/hr.
 * Resumable: checkpoint after each product to scripts/.enrich-catalogue-checkpoint.json
 *
 * Modes:
 *   --limit N         max products to process (default 300 for scoped test)
 *   --priority=cover  only products with cover_image_url IS NULL (default)
 *   --priority=all    any product lacking comicvine_id
 *   --rate-ms N       override per-request delay in milliseconds (default 18000)
 *   --reset           wipe the checkpoint and start fresh
 *   --dry-run         classify and report, no DB writes
 *
 * Usage:
 *   npm run enrich:catalogue -- --limit 300
 *   npm run enrich:catalogue -- --limit 300 --dry-run
 *   npm run enrich:catalogue -- --limit 50000 --priority=all   (full pass)
 */

import { PrismaClient } from '@prisma/client'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { downloadAndStoreCoverWithFallback } from '../lib/images/download'
import { classifyTextForEnrichment } from '../lib/search/isLikelyComic'

const prisma = new PrismaClient()

// ── CLI parsing ────────────────────────────────────────────────────────────────

interface Args {
  limit:    number
  priority: 'cover' | 'all'
  rateMs:   number
  reset:    boolean
  dryRun:   boolean
  report:   boolean
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const args: Args = { limit: 300, priority: 'cover', rateMs: 25000, reset: false, dryRun: false, report: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--limit')               args.limit = parseInt(argv[++i] ?? '300', 10)
    else if (a.startsWith('--limit=')) args.limit = parseInt(a.split('=')[1], 10)
    else if (a === '--priority')               args.priority = (argv[++i] ?? 'cover') as 'cover' | 'all'
    else if (a.startsWith('--priority='))      args.priority = (a.split('=')[1]) as 'cover' | 'all'
    else if (a === '--rate-ms')               args.rateMs = parseInt(argv[++i] ?? '18000', 10)
    else if (a.startsWith('--rate-ms='))      args.rateMs = parseInt(a.split('=')[1], 10)
    else if (a === '--reset')   args.reset = true
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--report')  args.report = true
  }
  return args
}

// ── Checkpoint ────────────────────────────────────────────────────────────────

const CHECKPOINT_PATH = join(__dirname, '.enrich-catalogue-checkpoint.json')

interface Checkpoint {
  startedAt:        string
  lastUpdatedAt:    string
  processedIds:     string[]   // canonical_product ids already attempted (matched or not)
  stats: {
    seen:              number
    matched:           number
    unmatched:         number
    coversRecovered:   number
    skippedNoSignal:   number
    cvApiErrors:       number
  }
}

function loadCheckpoint(): Checkpoint {
  if (existsSync(CHECKPOINT_PATH)) {
    try {
      return JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf8'))
    } catch {}
  }
  return {
    startedAt:     new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    processedIds:  [],
    stats:         { seen: 0, matched: 0, unmatched: 0, coversRecovered: 0, skippedNoSignal: 0, cvApiErrors: 0 },
  }
}

function saveCheckpoint(c: Checkpoint) {
  mkdirSync(dirname(CHECKPOINT_PATH), { recursive: true })
  c.lastUpdatedAt = new Date().toISOString()
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(c, null, 2))
}

// ── CV API ────────────────────────────────────────────────────────────────────

const CV_BASE = 'https://comicvine.gamespot.com/api'
const CV_KEY  = process.env.COMIC_VINE_API_KEY

interface CVImage { small_url?: string; medium_url?: string; original_url?: string; super_url?: string }
interface CVCreator { id: number; name: string; role: string }
interface CVCharacter { id: number; name: string }
interface CVVolume {
  id:               number
  name:             string
  start_year:       string | null
  description:      string | null
  publisher:        { id: number; name: string } | null
  count_of_issues:  number
  image:            CVImage | null
  // returned on /volume/4050-{id}/ detail call (not search)
  people?:          CVCreator[]
  characters?:      CVCharacter[]
}

// Hard 30s timeout per CV request. Without this an unresponsive CV connection
// hangs forever — the first 300-test run died at product #254 this way after
// 1.5h of progress. AbortSignal.timeout throws TimeoutError which the catch
// converts to a logged null, the outer loop continues to the next product.
const CV_TIMEOUT_MS = 30_000

// 420 "Enhance Your Calm" backoff. The v3 run hit 50/300 HTTP 420s at
// 18s/call — CV's per-window enforcement is tighter than the documented
// 200/hr cap. On 420 we sleep 60s and retry up to MAX_420_RETRIES times;
// only after all retries fail do we return null (treat as unmatched).
const RETRY_BACKOFF_MS = 60_000
const MAX_420_RETRIES  = 3

async function cvFetch<T>(path: string): Promise<T | null> {
  const sep = path.includes('?') ? '&' : '?'
  const url = `${CV_BASE}${path}${sep}api_key=${CV_KEY}&format=json`

  for (let attempt = 0; attempt <= MAX_420_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        signal:  AbortSignal.timeout(CV_TIMEOUT_MS),
        headers: { 'User-Agent': 'CatchComics/1.0 catalogue-enrich' },
      })

      // 420 = "Enhance Your Calm" — Cloudflare/CV rate limit. Wait and retry.
      if (res.status === 420 || res.status === 429) {
        if (attempt < MAX_420_RETRIES) {
          console.warn(`  [cv] ${res.status} — backing off ${RETRY_BACKOFF_MS/1000}s (attempt ${attempt+1}/${MAX_420_RETRIES})`)
          await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS))
          continue
        }
        console.warn(`  [cv] ${res.status} — gave up after ${MAX_420_RETRIES} retries on ${path.slice(0,80)}`)
        return null
      }

      if (!res.ok) {
        console.warn(`  [cv] ${res.status} ${res.statusText} for ${path.slice(0,80)}`)
        return null
      }

      const json = await res.json()
      if (json.status_code && json.status_code !== 1) {
        console.warn(`  [cv] status_code=${json.status_code} error=${json.error}`)
        return null
      }
      return json.results as T
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.warn(`  [cv] fetch failed (${msg}) for ${path.slice(0,80)}`)
      return null
    }
  }
  return null
}

// ── Matching ──────────────────────────────────────────────────────────────────

const STOP = new Set(['the','a','an','of','and','vol','volume','edition','book','part',
  'omnibus','deluxe','complete','absolute','collected'])

function tokenise(s: string): string[] {
  return s.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP.has(w))
}

function f1Similarity(a: string, b: string): number {
  const qa = new Set(tokenise(a)), qb = new Set(tokenise(b))
  if (qa.size === 0 || qb.size === 0) return 0
  let hits = 0
  for (const w of qa) if (qb.has(w)) hits++
  const p = hits / qa.size, r = hits / qb.size
  if (p + r === 0) return 0
  return (2 * p * r) / (p + r)
}

// Strip volume/edition suffixes from a product title so the CV search keys on
// the series name rather than the edition: "Batman Vol. 1: Their Dark Designs"
// → "Batman: Their Dark Designs" (or just "Batman" via the series_name field).
function cleanQueryText(title: string, seriesName: string | null): string {
  if (seriesName && seriesName.trim().length > 2) return seriesName.trim()
  return title
    .replace(/\b(?:vol(?:ume)?\.?\s*\d+|book\s*\d+|part\s*\d+)\b[:\s-]*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

interface MatchResult {
  volume:     CVVolume
  similarity: number
  reason:     string
}

async function findCvMatch(
  title:     string,
  publisher: string | null,
  seriesName:string | null,
): Promise<MatchResult | null> {
  const q = cleanQueryText(title, seriesName)
  if (!q || q.length < 3) return null

  const results = await cvFetch<CVVolume[]>(
    `/search/?resources=volume&query=${encodeURIComponent(q)}&limit=10&field_list=id,name,start_year,publisher,count_of_issues,image`
  )
  if (!results || results.length === 0) return null

  // Acceptance gates:
  //   Tier 1: sim >= 0.85                             → accept (very strong title match)
  //   Tier 2: sim >= 0.55 AND pubOk                   → accept (medium + publisher confirms)
  //   Then THREE additional rejects (from 300-test post-mortem):
  //     R1: count_of_issues <= 1 AND !pubOk AND sim < 0.95
  //         → one-issue specials without publisher confirmation are almost
  //           always graphic-novel adaptations of unrelated history/bio works
  //           ("History of the American People" → "A People's History of
  //            American Empire" wrong match)
  //     R2: significantWords(productTitle) <= 2 AND (!pubOk OR issues <= 1)
  //         → short product titles collide on single rare tokens. Abraham
  //           Lincoln Volume 2 matched at sim=1.00 because both titles
  //           reduce to "lincoln" alone. Require BOTH publisher AND multi-
  //           issue evidence when the product title is this terse.
  //     R3: (already covered by Tier 1+2 — kept implicit)
  const SIM_STRONG = 0.85
  const SIM_MEDIUM = 0.55
  const SIM_VERY_STRONG = 0.95

  const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().trim()
  const dbPubNorm = norm(publisher)
  const dbPubFirstWord = dbPubNorm.split(/[\s,]/).filter(w => w.length > 2)[0] ?? ''

  // Count significant (non-stopword) tokens in the cleaned query — used by R2.
  const queryWords = tokenise(q)
  const productSignificantWordCount = queryWords.length

  const scored = results.map(v => {
    const cvPubNorm = norm(v.publisher?.name)
    const cvPubFirstWord = cvPubNorm.split(/[\s,]/).filter(w => w.length > 2)[0] ?? ''
    const pubOk = dbPubNorm && cvPubNorm && (
      (dbPubFirstWord && cvPubNorm.includes(dbPubFirstWord)) ||
      (cvPubFirstWord && dbPubNorm.includes(cvPubFirstWord))
    )
    return { v, sim: f1Similarity(q, v.name ?? ''), pubOk: !!pubOk }
  })
    // Tier 1 / Tier 2 base acceptance
    .filter(s => (s.sim >= SIM_STRONG) || (s.sim >= SIM_MEDIUM && s.pubOk))
    // R1: reject one-issue specials without publisher confirmation
    .filter(s => !(
      (s.v.count_of_issues ?? 0) <= 1 && !s.pubOk && s.sim < SIM_VERY_STRONG
    ))
    // R2: reject short-title matches without strong corroboration
    .filter(s => !(
      productSignificantWordCount <= 2 && (!s.pubOk || (s.v.count_of_issues ?? 0) <= 1)
    ))

  if (scored.length === 0) return null

  scored.sort((a, b) =>
    Number(b.pubOk) - Number(a.pubOk)
    || b.sim - a.sim
    || (b.v.count_of_issues ?? 0) - (a.v.count_of_issues ?? 0)
  )

  const best = scored[0]
  const reason = `sim=${best.sim.toFixed(2)} pubOk=${best.pubOk} issues=${best.v.count_of_issues ?? '?'} words=${productSignificantWordCount}`
  return { volume: best.v, similarity: best.sim, reason }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function pickCover(v: CVVolume): string | null {
  return v.image?.super_url || v.image?.original_url || v.image?.medium_url || v.image?.small_url || null
}

async function fetchVolumeDetail(volId: number): Promise<CVVolume | null> {
  return cvFetch<CVVolume>(
    `/volume/4050-${volId}/?field_list=id,name,start_year,publisher,count_of_issues,image,description,people,characters`
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function reportProgress() {
  const cp = loadCheckpoint()
  const total = await prisma.$queryRaw<Array<{ cnt: number }>>`
    SELECT COUNT(*)::int AS cnt FROM canonical_products WHERE deleted_at IS NULL
  `
  const enriched = await prisma.$queryRaw<Array<{ cnt: number }>>`
    SELECT COUNT(*)::int AS cnt FROM canonical_products WHERE comicvine_id IS NOT NULL AND deleted_at IS NULL
  `
  const todayMatches = cp.processedIds.length
  const remainingRaw = await prisma.$queryRaw<Array<{ cnt: number }>>`
    SELECT COUNT(*)::int AS cnt FROM canonical_products
    WHERE comicvine_id IS NULL AND deleted_at IS NULL
  `
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('ENRICHMENT CHECKPOINT REPORT')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`  Started at:                  ${cp.startedAt}`)
  console.log(`  Last update:                 ${cp.lastUpdatedAt}`)
  console.log(`  Products attempted:          ${todayMatches}`)
  console.log(`  Cumulative matched:          ${cp.stats.matched}`)
  console.log(`  Cumulative unmatched:        ${cp.stats.unmatched}`)
  console.log(`  Cumulative covers recovered: ${cp.stats.coversRecovered}`)
  console.log(`  Cumulative CV API errors:    ${cp.stats.cvApiErrors}`)
  console.log('')
  console.log(`  Catalogue total (live):      ${total[0].cnt}`)
  console.log(`  With comicvine_id:           ${enriched[0].cnt} (${((enriched[0].cnt/total[0].cnt)*100).toFixed(1)}%)`)
  console.log(`  Remaining without CV link:   ${remainingRaw[0].cnt}`)

  // Rough completion estimate
  const matchRate = cp.stats.matched + cp.stats.unmatched > 0
    ? cp.stats.matched / (cp.stats.matched + cp.stats.unmatched)
    : 0
  if (matchRate > 0 && cp.stats.matched > 0) {
    // ~36s per product when matched (search + detail), 18s when unmatched
    const avgSec = matchRate * 36 + (1 - matchRate) * 18
    const remainingSec = remainingRaw[0].cnt * avgSec
    const days = remainingSec / 86400
    console.log(`  Est. days to finish (24/7):  ${days.toFixed(1)}`)
  }

  await prisma.$disconnect()
}

async function main() {
  if (!CV_KEY) { console.error('COMIC_VINE_API_KEY not set'); process.exit(1) }
  const args = parseArgs()
  if (args.report) {
    await reportProgress()
    return
  }
  console.log(`Mode: limit=${args.limit} priority=${args.priority} rate=${args.rateMs}ms dryRun=${args.dryRun}`)

  let cp = loadCheckpoint()
  if (args.reset) {
    console.log('--reset specified, wiping checkpoint')
    cp = { startedAt: new Date().toISOString(), lastUpdatedAt: new Date().toISOString(), processedIds: [], stats: { seen: 0, matched: 0, unmatched: 0, coversRecovered: 0, skippedNoSignal: 0, cvApiErrors: 0 } }
    saveCheckpoint(cp)
  }
  const processedSet = new Set(cp.processedIds)
  console.log(`Resuming from checkpoint: ${cp.processedIds.length} already processed`)

  // Candidate query — products lacking comicvine_id.
  // Over-fetch generously: the pre-filter (isLikelyComic on title+publisher)
  // typically discards the majority of WoB-style pollution (German academic
  // books, Latin classics, cookbooks etc.) so we need a much larger raw pool
  // to land args.limit real comic candidates.
  const candidates = await prisma.$queryRawUnsafe<Array<{
    id: string; title: string; publisher: string | null;
    series_name: string | null; cover_image_url: string | null; description: string | null
  }>>(`
    SELECT id, title, publisher, series_name, cover_image_url, description
    FROM canonical_products
    WHERE comicvine_id IS NULL
      AND deleted_at IS NULL
      ${args.priority === 'cover' ? 'AND cover_image_url IS NULL' : ''}
    ORDER BY (format::text IN ('SINGLE_ISSUE','MANGA_VOLUME','OMNIBUS','ABSOLUTE','COMPENDIUM','DELUXE')) DESC,
             (format::text IN ('TPB','HARDCOVER')) DESC,
             (publisher IS NOT NULL) DESC,
             updated_at DESC NULLS LAST,
             id
    LIMIT ${Math.min(args.limit * 30, 200000)}
  `)

  // Pre-filter: enrichment-specific classifier — STRICTER than search-time.
  // The 'volume '/'vol.' signals are stripped from this list because they
  // let through history/biography books with "Volume N" titles (the four
  // wrong matches in the previous 300-test all came in this way).
  const looksLikeComic = (c: { title: string; publisher: string | null }) =>
    classifyTextForEnrichment(`${c.title} ${c.publisher ?? ''}`) === 'comic'

  const filtered = candidates.filter(c => !processedSet.has(c.id) && looksLikeComic(c))
  const pool     = filtered.slice(0, args.limit)
  console.log(`Candidate pool: ${candidates.length} raw → ${filtered.length} pass comic filter → ${pool.length} selected`)

  // Audit trail of successful matches (sample for spot-checking)
  const auditSamples: Array<Record<string, unknown>> = []
  // Wrong-match canaries — review later
  const reviewSamples: Array<Record<string, unknown>> = []

  for (let i = 0; i < pool.length; i++) {
    const p = pool[i]
    cp.stats.seen++
    console.log(`\n[${i+1}/${pool.length}] ${p.title.slice(0, 70)}`)

    // Try the match
    let match: MatchResult | null = null
    try {
      match = await findCvMatch(p.title, p.publisher, p.series_name)
    } catch (e) {
      console.warn(`  [match] error: ${e instanceof Error ? e.message : e}`)
      cp.stats.cvApiErrors++
    }

    if (!match) {
      console.log(`  ✗ no confident match`)
      cp.stats.unmatched++
      processedSet.add(p.id)
      cp.processedIds = [...processedSet]
      saveCheckpoint(cp)
      await new Promise(r => setTimeout(r, args.rateMs))
      continue
    }

    console.log(`  ✓ match: "${match.volume.name}" (${match.volume.start_year}) id=${match.volume.id} ${match.reason}`)

    if (args.dryRun) {
      cp.stats.matched++
      auditSamples.push({
        productTitle: p.title,
        productPublisher: p.publisher,
        cvName: match.volume.name,
        cvId: match.volume.id,
        cvPublisher: match.volume.publisher?.name,
        similarity: match.similarity,
      })
      processedSet.add(p.id)
      cp.processedIds = [...processedSet]
      saveCheckpoint(cp)
      await new Promise(r => setTimeout(r, args.rateMs))
      continue
    }

    // Fetch detailed volume metadata (creators, characters, description)
    await new Promise(r => setTimeout(r, args.rateMs))
    const detail = await fetchVolumeDetail(match.volume.id) ?? match.volume

    const cvMeta = {
      cv_volume_id:  match.volume.id,
      start_year:    detail.start_year,
      cv_publisher:  detail.publisher?.name ?? null,
      synopsis:      detail.description,
      creators:      Array.isArray(detail.people) ? detail.people.map(p => ({ id: p.id, name: p.name, role: p.role })) : [],
      characters:    Array.isArray(detail.characters) ? detail.characters.map(c => ({ id: c.id, name: c.name })) : [],
      match_sim:     match.similarity,
      enriched_at:   new Date().toISOString(),
    }

    const newSeriesName = (!p.series_name || p.series_name.trim().length < 2) ? detail.name : p.series_name
    const newPublisher  = (!p.publisher  || p.publisher.trim().length === 0)  ? (detail.publisher?.name ?? null) : p.publisher
    // Use existing description if present and non-trivial; otherwise CV's synopsis.
    const newDesc       = (!p.description || p.description.trim().length < 20) ? (detail.description ?? null) : p.description

    // Patch the row
    await prisma.$executeRaw`
      UPDATE canonical_products SET
        comicvine_id  = ${String(match.volume.id)},
        cv_metadata   = ${JSON.stringify(cvMeta)}::jsonb,
        series_name   = ${newSeriesName},
        publisher     = ${newPublisher},
        description   = ${newDesc},
        updated_at    = NOW()
      WHERE id = ${p.id}::uuid
    `

    // Cover backfill if missing
    if (!p.cover_image_url) {
      const cvCover = pickCover(detail)
      if (cvCover) {
        const result = await downloadAndStoreCoverWithFallback(p.id, { cvUrl: cvCover })
        if (result) {
          cp.stats.coversRecovered++
          console.log(`  ↳ cover stored to R2`)
        }
      }
    }

    cp.stats.matched++
    if (auditSamples.length < 12) {
      auditSamples.push({
        productTitle: p.title,
        productPublisher: p.publisher,
        oldCover: p.cover_image_url,
        newCvId: match.volume.id,
        newSeriesName,
        newPublisher,
        descLen: (newDesc ?? '').length,
        creators: cvMeta.creators.length,
        characters: cvMeta.characters.length,
        similarity: match.similarity,
      })
    }
    if (match.similarity < 0.7 && reviewSamples.length < 20) {
      reviewSamples.push({
        productTitle: p.title,
        productPublisher: p.publisher,
        cvName: match.volume.name,
        cvPublisher: match.volume.publisher?.name,
        similarity: match.similarity,
      })
    }

    processedSet.add(p.id)
    cp.processedIds = [...processedSet]
    saveCheckpoint(cp)
    await new Promise(r => setTimeout(r, args.rateMs))
  }

  // ── Final report ──────────────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('ENRICHMENT RUN COMPLETE')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`  Seen this run:       ${pool.length}`)
  console.log(`  Matched:             ${cp.stats.matched - (cp.stats.matched - pool.length > 0 ? 0 : 0)}`)
  console.log(`  Stats (cumulative across all runs):`)
  console.log(`    matched:           ${cp.stats.matched}`)
  console.log(`    unmatched:         ${cp.stats.unmatched}`)
  console.log(`    covers recovered:  ${cp.stats.coversRecovered}`)
  console.log(`    CV API errors:     ${cp.stats.cvApiErrors}`)

  if (auditSamples.length > 0) {
    console.log('\n=== Sample matches (audit) ===')
    auditSamples.slice(0, 10).forEach((s, i) => {
      console.log(`  ${i+1}. ${JSON.stringify(s, null, 2).split('\n').join('\n     ')}`)
    })
  }
  if (reviewSamples.length > 0) {
    console.log(`\n=== Low-confidence matches (sim 0.5–0.7) — spot-check these ===`)
    reviewSamples.forEach((s, i) => console.log(`  ${i+1}. ${JSON.stringify(s)}`))
  }

  await prisma.$disconnect()
}

main().catch(async e => { console.error('Enrichment failed:', e); await prisma.$disconnect(); process.exit(1) })
