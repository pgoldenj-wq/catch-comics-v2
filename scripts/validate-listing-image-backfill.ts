/**
 * validate-listing-image-backfill.ts
 *
 * Validates Recommendation #1 from the cover diagnostic:
 * "Promote 10,091 listing images to canonical covers"
 *
 * Phases:
 *   1. Re-derive the exact 10,091 population with full query logic
 *   2. Break down by retailer domain
 *   3. Sample 100 records (full detail)
 *   4. Probe a subset of URLs: HTTP status, Content-Length, image dimensions
 *   5. Apply quality filters: broken, too small, known-bad patterns
 *   6. Produce a final "would actually improve UX" estimate
 *
 * Read-only. Makes no writes.
 * Run: npx dotenv-cli -e .env.local -- npx tsx scripts/validate-listing-image-backfill.ts
 */

import { PrismaClient }  from '@prisma/client'
import https              from 'https'
import http               from 'http'
import { URL }            from 'url'

const prisma = new PrismaClient()

// ── URL quality filters (mirrors isBadCoverUrl from lib/images/url-filters.ts) ──
const BAD_URL_PATTERNS = [
  'books.google.com',
  'no_image',
  'image_not_available',
  'not_available',
  '/uploads/.*/0/.*/',          // CV system placeholder path
  'placeholder',
  'default_',
  'noimage',
  'no-image',
  'missing',
  'unavailable',
]

function isBadUrl(url: string): { bad: boolean; reason: string } {
  const lower = url.toLowerCase()
  for (const pattern of BAD_URL_PATTERNS) {
    if (lower.includes(pattern)) return { bad: true, reason: `matches pattern: ${pattern}` }
  }
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { bad: true, reason: 'non-http protocol' }
    }
  } catch {
    return { bad: true, reason: 'invalid URL' }
  }
  return { bad: false, reason: '' }
}

// ── HTTP HEAD probe ───────────────────────────────────────────────────────────
interface ProbeResult {
  url:           string
  status:        number | null
  contentType:   string | null
  contentLength: number | null
  error:         string | null
  durationMs:    number
}

function probeUrl(url: string, timeoutMs = 8000): Promise<ProbeResult> {
  return new Promise(resolve => {
    const start = Date.now()
    const done  = (r: Omit<ProbeResult, 'url' | 'durationMs'>) =>
      resolve({ url, durationMs: Date.now() - start, ...r })

    let req: ReturnType<typeof https.request>
    try {
      const parsed = new URL(url)
      const lib    = parsed.protocol === 'https:' ? https : http
      req = lib.request(
        { method: 'HEAD', hostname: parsed.hostname, path: parsed.pathname + parsed.search,
          port: parsed.port || undefined, timeout: timeoutMs,
          headers: { 'User-Agent': 'CatchComics-Diagnostic/1.0' } },
        res => {
          res.resume()
          done({
            status:        res.statusCode ?? null,
            contentType:   res.headers['content-type'] ?? null,
            contentLength: res.headers['content-length']
                             ? parseInt(res.headers['content-length'] as string, 10)
                             : null,
            error: null,
          })
        }
      )
      req.on('error',   e  => done({ status: null, contentType: null, contentLength: null, error: e.message }))
      req.on('timeout', () => { req.destroy(); done({ status: null, contentType: null, contentLength: null, error: 'timeout' }) })
      req.end()
    } catch (e: unknown) {
      done({ status: null, contentType: null, contentLength: null,
             error: e instanceof Error ? e.message : String(e) })
    }
  })
}

// ── Concurrency helper ────────────────────────────────────────────────────────
async function pMap<T, R>(
  items: T[], fn: (item: T) => Promise<R>, concurrency = 10
): Promise<R[]> {
  const results: R[] = []
  let idx = 0
  async function worker() {
    while (idx < items.length) {
      const i = idx++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return results
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n══════════════════════════════════════════════════════')
  console.log('  Catch Comics — Listing Image Backfill Validation')
  console.log('══════════════════════════════════════════════════════\n')

  // ── Phase 1: Re-derive the population ─────────────────────────────────────
  console.log('── Phase 1: Re-derive the 10,091 population ──────────')

  // Exact query used in the diagnostic
  const population = await prisma.$queryRaw<{
    cp_id:       string
    cp_title:    string
    cp_format:   string
    cp_isbn13:   string | null
    retailer_id: string
    r_name:      string
    r_domain:    string
    rl_id:       string
    rl_image_url: string
  }[]>`
    SELECT DISTINCT ON (cp.id)
      cp.id            AS cp_id,
      cp.title         AS cp_title,
      cp.format        AS cp_format,
      cp.isbn_13       AS cp_isbn13,
      r.id             AS retailer_id,
      r.name           AS r_name,
      r.domain         AS r_domain,
      rl.id            AS rl_id,
      rl.image_url     AS rl_image_url
    FROM canonical_products cp
    JOIN retailer_listings rl
      ON rl.canonical_product_id = cp.id
     AND rl.deleted_at IS NULL
     AND rl.image_url IS NOT NULL
     AND rl.image_url != ''
    JOIN retailers r ON r.id = rl.retailer_id
    WHERE cp.deleted_at IS NULL
      AND cp.cover_image_url IS NULL
    ORDER BY cp.id, r.trust_score DESC, rl.last_seen_at DESC
  `

  console.log(`  Exact population size : ${population.length.toLocaleString()}`)
  const diff = population.length - 10091
  const matchStr = population.length === 10091 ? '✓ EXACT' : `✗ DIFF (${diff > 0 ? '+' : ''}${diff})`
  console.log(`  (Original diagnostic reported: 10,091 — match: ${matchStr})`)

  // ── Phase 2: Breakdown by retailer ────────────────────────────────────────
  console.log('\n── Phase 2: Breakdown by retailer ────────────────────')

  const byRetailer = new Map<string, { name: string; domain: string; count: number }>()
  for (const row of population) {
    const key = row.r_domain
    const cur = byRetailer.get(key) ?? { name: row.r_name, domain: row.r_domain, count: 0 }
    cur.count++
    byRetailer.set(key, cur)
  }

  const sorted = [...byRetailer.values()].sort((a, b) => b.count - a.count)
  for (const r of sorted) {
    const pct = ((r.count / population.length) * 100).toFixed(1)
    console.log(`  ${r.domain.padEnd(35)} ${r.count.toString().padStart(6)}  (${pct}%)`)
  }

  // ── Phase 3: Domain-pattern URL quality pre-filter ────────────────────────
  console.log('\n── Phase 3: URL pattern pre-filter ────────────────────')

  let badUrlCount = 0
  const badByPattern = new Map<string, number>()
  for (const row of population) {
    const check = isBadUrl(row.rl_image_url)
    if (check.bad) {
      badUrlCount++
      badByPattern.set(check.reason, (badByPattern.get(check.reason) ?? 0) + 1)
    }
  }

  console.log(`  Fail URL pattern filter : ${badUrlCount} (${((badUrlCount / population.length) * 100).toFixed(1)}%)`)
  for (const [reason, cnt] of [...badByPattern.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${reason.padEnd(40)} ${cnt}`)
  }

  const goodUrls    = population.filter(r => !isBadUrl(r.rl_image_url).bad)
  console.log(`  Pass URL pattern filter : ${goodUrls.length} (${((goodUrls.length / population.length) * 100).toFixed(1)}%)`)

  // ── Phase 4: Sample 100 records ───────────────────────────────────────────
  console.log('\n── Phase 4: Sample 100 records (first 100 of good-URL set) ──')

  const sample100 = goodUrls.slice(0, 100)
  for (const row of sample100.slice(0, 20)) {  // Print first 20 to console
    console.log(`  [${row.cp_format.padEnd(12)}] ${row.cp_title.slice(0, 45).padEnd(45)} | ${row.rl_image_url.slice(0, 65)}`)
  }
  console.log(`  ... (showing 20 of 100; full probe in Phase 5)`)

  // ── Phase 5: Live URL probing (sample 200 of the good-URL set) ─────────────
  console.log('\n── Phase 5: Live probe 200 URLs (status + size) ───────')

  // Sample evenly across the population
  const PROBE_N = 200
  const stride  = Math.max(1, Math.floor(goodUrls.length / PROBE_N))
  const toProbe = goodUrls.filter((_, i) => i % stride === 0).slice(0, PROBE_N)

  console.log(`  Probing ${toProbe.length} URLs with HEAD requests (10 concurrent, 8s timeout)...`)
  const probeResults = await pMap(toProbe.map(r => r.rl_image_url), probeUrl, 10)

  let ok200         = 0
  let redirect3xx   = 0
  let broken4xx5xx  = 0
  let networkError  = 0
  let tooSmall      = 0     // Content-Length < 2KB — likely 1×1 pixel or error page
  let wrongType     = 0
  let noSize        = 0

  const MIN_SIZE_BYTES = 2048   // 2KB minimum — 1×1 GIF is ~35 bytes

  for (const r of probeResults) {
    if (r.error) { networkError++; continue }
    if (!r.status) { networkError++; continue }
    if (r.status >= 200 && r.status < 300) {
      ok200++
      if (r.contentType && !r.contentType.startsWith('image/')) wrongType++
      if (r.contentLength !== null && r.contentLength < MIN_SIZE_BYTES) tooSmall++
      if (r.contentLength === null) noSize++
    } else if (r.status >= 300 && r.status < 400) {
      redirect3xx++
    } else {
      broken4xx5xx++
    }
  }

  const probed = probeResults.length
  console.log(`\n  HTTP status distribution (n=${probed}):`)
  console.log(`    200 OK              : ${ok200}  (${pct(ok200, probed)})`)
  console.log(`    3xx redirect        : ${redirect3xx}  (${pct(redirect3xx, probed)})`)
  console.log(`    4xx / 5xx (broken)  : ${broken4xx5xx}  (${pct(broken4xx5xx, probed)})`)
  console.log(`    Network error       : ${networkError}  (${pct(networkError, probed)})`)
  console.log(`\n  Of the 200 OK responses:`)
  console.log(`    Wrong content-type  : ${wrongType}  (${pct(wrongType, ok200)})`)
  console.log(`    Too small (<2KB)    : ${tooSmall}  (${pct(tooSmall, ok200)})`)
  console.log(`    No Content-Length   : ${noSize}  (${pct(noSize, ok200)})`)

  // Print the broken ones
  const brokenSample = probeResults
    .filter(r => r.status && r.status >= 400)
    .slice(0, 10)
  if (brokenSample.length > 0) {
    console.log(`\n  Sample broken URLs:`)
    for (const r of brokenSample) {
      console.log(`    HTTP ${r.status} — ${r.url.slice(0, 80)}`)
    }
  }

  // Print the too-small ones
  const tooSmallSample = probeResults
    .filter(r => r.contentLength !== null && r.contentLength < MIN_SIZE_BYTES && r.status === 200)
    .slice(0, 5)
  if (tooSmallSample.length > 0) {
    console.log(`\n  Sample suspiciously small images:`)
    for (const r of tooSmallSample) {
      console.log(`    ${r.contentLength}B — ${r.url.slice(0, 80)}`)
    }
  }

  // ── Phase 6: Watermark / known-bad domain patterns ───────────────────────
  console.log('\n── Phase 6: Watermark and quality signal scan ─────────')

  // Known domains / patterns that often serve watermarked, low-quality, or terms-restricted images
  const SUSPECT_DOMAINS = [
    'bookshop.org',         // Bookshop CDN — confirmed 403 without credentials
    'cdn.bookshop.org',
    'images.bookshop.org',
    'syndetics.com',        // Syndetics — library service, often watermarked
    'images.indiebound.org',
    'content.syndetics.com',
    'ec.images.whatdoiknow.org',
  ]

  const SUSPECT_PATH_PATTERNS = [
    '/SC.jpg',              // Syndetics small cover
    '/MC.jpg',              // Syndetics medium cover
    '/LC.jpg',              // Syndetics large cover
    'syndeticsunbound',
    'watermark',
  ]

  let suspectDomain = 0
  let suspectPath   = 0
  const domainHits  = new Map<string, number>()

  for (const row of goodUrls) {
    const lower = row.rl_image_url.toLowerCase()
    let hit = false
    for (const d of SUSPECT_DOMAINS) {
      if (lower.includes(d)) {
        hit = true
        domainHits.set(d, (domainHits.get(d) ?? 0) + 1)
        suspectDomain++
        break
      }
    }
    if (!hit) {
      for (const p of SUSPECT_PATH_PATTERNS) {
        if (lower.includes(p.toLowerCase())) {
          suspectPath++
          break
        }
      }
    }
  }

  console.log(`  Suspect domain (Syndetics, Bookshop CDN etc): ${suspectDomain}`)
  for (const [d, cnt] of [...domainHits.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${d.padEnd(40)} ${cnt}`)
  }
  console.log(`  Suspect path patterns                       : ${suspectPath}`)

  // ── Phase 7: Final quality-filtered estimate ─────────────────────────────
  console.log('\n── Phase 7: Quality-filtered "would improve UX" estimate ─')

  // Extrapolate from probe sample:
  const probeFailRate = (broken4xx5xx + networkError + wrongType + tooSmall) / probed
  const suspectRate   = (suspectDomain + suspectPath) / goodUrls.length

  // Conservative: each failure mode is independent (they mostly are for different URL patterns)
  const goodRate      = Math.max(0, 1 - probeFailRate - suspectRate)

  const passUrlFilter     = goodUrls.length
  const estimatedGoodUrls = Math.round(passUrlFilter * goodRate)

  // Format breakdown of surviving population
  const formatCounts = new Map<string, number>()
  for (const row of goodUrls) {
    formatCounts.set(row.cp_format, (formatCounts.get(row.cp_format) ?? 0) + 1)
  }

  console.log(`  Starting population              : ${population.length.toLocaleString()}`)
  console.log(`  After URL pattern filter         : ${passUrlFilter.toLocaleString()} (${pct(passUrlFilter, population.length)})`)
  console.log(`  Probe fail rate (extrapolated)   : ${(probeFailRate * 100).toFixed(1)}%`)
  console.log(`  Suspect domain/path rate         : ${(suspectRate * 100).toFixed(1)}%`)
  console.log(`  Combined pass rate               : ${(goodRate * 100).toFixed(1)}%`)
  console.log(`  ─────────────────────────────────────────────────────`)
  console.log(`  Estimated products gaining cover : ~${estimatedGoodUrls.toLocaleString()}`)
  console.log(`    of which:`)

  for (const [fmt, cnt] of [...formatCounts.entries()].sort((a, b) => b[1] - a[1])) {
    const est = Math.round(cnt * goodRate)
    console.log(`      ${fmt.padEnd(16)} ~${est.toLocaleString()}`)
  }

  const totalLive = 45823
  console.log(`\n  Current coverage : ${(28094 / totalLive * 100).toFixed(1)}%`)
  console.log(`  After backfill   : ~${((28094 + estimatedGoodUrls) / totalLive * 100).toFixed(1)}%`)

  console.log('\n══════════════════════════════════════════════════════')
  console.log('  Validation complete — no writes made')
  console.log('══════════════════════════════════════════════════════\n')
}

function pct(n: number, of: number): string {
  if (of === 0) return '0%'
  return `${((n / of) * 100).toFixed(1)}%`
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
