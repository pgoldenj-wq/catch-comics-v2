#!/usr/bin/env tsx
/**
 * Priority Wordery Enrichment — publisher-aware, high-yield-first.
 *
 * Problem with FIFO queue: the remaining TM-linked unpriced pool is dominated
 * by publishers Wordery barely stocks (VIZ legacy, Yen Press, Dark Horse US,
 * Image US). Naive FIFO wastes ~70% of requests on dead-pool ISBNs.
 *
 * This script:
 *   1. Scores each stub by its ISBN-prefix historical hit rate
 *   2. Skips prefixes with < MIN_HIT_RATE% empirical hit rate (dead pool)
 *   3. Fetches highest-scoring stubs first (most likely to yield a price)
 *   4. Logs prefix-level stats at end so the dead pool can be refined over time
 *
 * Hit rates are computed live from the DB — no hardcoded lists.
 * Dead-pool threshold: MIN_HIT_RATE (default 8%). Tune with --min-hit N.
 *
 * Usage:
 *   npx tsx scripts/enrich-wordery-priority.ts                 dry-run
 *   npx tsx scripts/enrich-wordery-priority.ts --write
 *   npx tsx scripts/enrich-wordery-priority.ts --limit 200 --write
 *   npx tsx scripts/enrich-wordery-priority.ts --min-hit 5 --write
 *   npx tsx scripts/enrich-wordery-priority.ts --dry-stats      prefix stats only, no fetches
 *
 * Rate limit: 20s between requests = 180 req/hr (safe under Wordery ~250/hr).
 * On 429: back off 90s, retry once. Abort after 5 consecutive 429s.
 */
import { prisma } from '../lib/prisma'
import { StockStatus } from '@prisma/client'

const args      = process.argv.slice(2)
const WRITE     = args.includes('--write')
const DRY       = !WRITE
const STATS_ONLY = args.includes('--dry-stats')
const limIdx    = args.indexOf('--limit')
const LIMIT     = limIdx !== -1 ? parseInt(args[limIdx + 1] ?? '200', 10) : 200
const hitIdx    = args.indexOf('--min-hit')
const MIN_HIT   = hitIdx !== -1 ? parseFloat(args[hitIdx + 1] ?? '8') : 8

const DELAY_MS      = 20_000
const BACKOFF_MS    = 90_000
const MAX_429_ABORT = 5

const HEADERS = {
  'User-Agent'               : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept'                   : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language'          : 'en-GB,en;q=0.9',
  'Accept-Encoding'          : 'gzip, deflate, br',
  'Connection'               : 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest'           : 'document',
  'Sec-Fetch-Mode'           : 'navigate',
  'Sec-Fetch-Site'           : 'none',
  'Sec-Fetch-User'           : '?1',
}

interface ExtractedOffer {
  price: number; currency: string; availability: StockStatus
}

function parseInertiaJson(html: string): ExtractedOffer | null {
  const marker = 'data-page="'
  const start  = html.indexOf(marker)
  if (start === -1) return null
  const valueStart = start + marker.length
  let valueEnd = valueStart
  while (valueEnd < html.length && html[valueEnd] !== '"') valueEnd++
  const decoded = html.slice(valueStart, valueEnd)
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  try {
    const page = JSON.parse(decoded) as { props?: { book?: { priceForPayment?: string }; availability?: { checkout?: { available?: boolean } } } }
    const price = parseFloat(page.props?.book?.priceForPayment ?? '')
    if (isNaN(price) || price <= 0) return null
    const available = page.props?.availability?.checkout?.available ?? false
    return { price, currency: 'GBP', availability: available ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK }
  } catch { return null }
}

async function fetchWorderyOffer(isbn13: string): Promise<ExtractedOffer | null | 'not_found' | '429'> {
  const url = `https://www.wordery.com/search?term=${encodeURIComponent(isbn13)}`
  let res: Response
  try {
    res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(20_000) })
  } catch (err) {
    console.error(`  [net error] ${isbn13}: ${(err as Error).message}`)
    return null
  }
  if (res.status === 429) { console.warn(`  [429] ${isbn13}`); return '429' }
  if (!res.ok) { console.error(`  [HTTP ${res.status}] ${isbn13}`); return null }
  const finalUrl = res.url
  if (finalUrl.includes('/search?term=') || finalUrl.includes('/search?q=')) return 'not_found'
  let html: string
  try { html = await res.text() } catch { return null }
  if (html.includes('"component":"SearchPage"') || html.includes('No results found')) return 'not_found'
  const offer = parseInertiaJson(html)
  if (!offer) { console.warn(`  [no data-page] ${isbn13}`); return null }
  return offer
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' Wordery — Priority Enrichment (publisher-aware)')
  console.log(` Mode     : ${DRY ? 'DRY-RUN (pass --write to save)' : 'WRITE'}`)
  console.log(` Limit    : ${LIMIT}`)
  console.log(` Min hit% : ${MIN_HIT}% (skip prefixes below this threshold)`)
  console.log('══════════════════════════════════════════════════════════\n')

  // ── Step 1: Compute per-prefix hit rates from existing data ───────────────
  const prefixRates = await prisma.$queryRaw<Array<{
    prefix: string; total: number; priced: number; hit_rate: number
  }>>`
    SELECT
      LEFT(rl.isbn_13, 7)                               AS prefix,
      COUNT(*)::int                                      AS total,
      COUNT(CASE WHEN rl.price_amount > 0 THEN 1 END)::int AS priced,
      ROUND(
        COUNT(CASE WHEN rl.price_amount > 0 THEN 1 END)::numeric
        / NULLIF(COUNT(*), 0) * 100, 1
      )                                                  AS hit_rate
    FROM retailer_listings rl
    JOIN retailers r ON r.id = rl.retailer_id
    WHERE r.domain = 'wordery.com'
      AND rl.deleted_at IS NULL
      AND rl.isbn_13 IS NOT NULL
    GROUP BY LEFT(rl.isbn_13, 7)
    HAVING COUNT(*) >= 3
  `

  const rateMap = new Map<string, number>()
  for (const r of prefixRates) {
    rateMap.set(r.prefix, r.hit_rate ?? 0)
  }

  // ── Step 2: Stats-only mode ───────────────────────────────────────────────
  if (STATS_ONLY) {
    const sorted = [...prefixRates].sort((a, b) => (b.hit_rate ?? 0) - (a.hit_rate ?? 0))
    console.log('── Prefix Hit Rates (all, sorted by hit rate) ───────────')
    console.log(`  ${'Prefix'.padEnd(9)} ${'Total'.padStart(6)} ${'Priced'.padStart(7)} ${'Hit%'.padStart(6)}`)
    for (const r of sorted) {
      const tag = (r.hit_rate ?? 0) >= MIN_HIT ? '✓' : '✗ SKIP'
      console.log(`  ${r.prefix.padEnd(9)} ${String(r.total).padStart(6)} ${String(r.priced).padStart(7)} ${String(r.hit_rate ?? 0).padStart(5)}%  ${tag}`)
    }
    const skipCount = sorted.filter(r => (r.hit_rate ?? 0) < MIN_HIT).reduce((acc, r) => acc + r.total, 0)
    const keepCount = sorted.filter(r => (r.hit_rate ?? 0) >= MIN_HIT).reduce((acc, r) => acc + r.total, 0)
    console.log(`\n  Would skip : ${skipCount.toLocaleString()} stubs (below ${MIN_HIT}% threshold)`)
    console.log(`  Would try  : ${keepCount.toLocaleString()} stubs`)
    console.log('══════════════════════════════════════════════════════════\n')
    return
  }

  // ── Step 3: Build priority queue — TM-linked, unpriced, above threshold ───
  // We fetch ALL eligible stubs and sort client-side by prefix hit rate.
  // This avoids complex SQL ranking while staying accurate.
  const allStubs = await prisma.$queryRaw<Array<{
    id: string; isbn13: string; prefix: string
  }>>`
    SELECT rl.id, rl.isbn_13 AS isbn13, LEFT(rl.isbn_13, 7) AS prefix
    FROM retailer_listings rl
    JOIN retailers r ON r.id = rl.retailer_id
    WHERE r.domain = 'wordery.com'
      AND rl.deleted_at IS NULL
      AND rl.price_amount <= 0
      AND rl.isbn_13 IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM retailer_listings tm_rl
        JOIN retailers tm_r ON tm_r.id = tm_rl.retailer_id
        WHERE tm_r.domain = 'travellingman.com'
          AND tm_rl.canonical_product_id = rl.canonical_product_id
          AND tm_rl.deleted_at IS NULL
          AND tm_rl.price_amount > 0
      )
    ORDER BY rl.first_seen_at DESC
  `

  // Filter out dead-pool prefixes, sort remaining by hit rate desc
  const eligible = allStubs
    .map(s => ({ ...s, hitRate: rateMap.get(s.prefix) ?? 0 }))
    .filter(s => s.hitRate >= MIN_HIT)
    .sort((a, b) => b.hitRate - a.hitRate)

  const skipped = allStubs.length - eligible.length
  const queue   = eligible.slice(0, LIMIT)

  console.log(`Total TM-linked unpriced stubs : ${allStubs.length.toLocaleString()}`)
  console.log(`Skipped (below ${MIN_HIT}% threshold): ${skipped.toLocaleString()}`)
  console.log(`Eligible after filter          : ${eligible.length.toLocaleString()}`)
  console.log(`This batch                     : ${queue.length.toLocaleString()}\n`)

  if (queue.length === 0) {
    console.log('  Nothing to enrich above the hit-rate threshold.')
    console.log('  Lower --min-hit or accept the dead pool.')
    return
  }

  // Show prefix breakdown of what we'll attempt
  const prefixGroups = new Map<string, number>()
  for (const s of queue) {
    prefixGroups.set(s.prefix, (prefixGroups.get(s.prefix) ?? 0) + 1)
  }
  console.log('── This batch by prefix ─────────────────────────────────')
  for (const [pfx, cnt] of [...prefixGroups.entries()].sort((a, b) => b[1] - a[1])) {
    const rate = rateMap.get(pfx) ?? 0
    console.log(`  ${pfx}  ×${cnt}  (${rate}% historical hit)`)
  }
  console.log()

  // ── Step 4: Enrich ────────────────────────────────────────────────────────
  const stats = { fetched: 0, priced: 0, notFound: 0, errors: 0, rateLimit: 0 }
  const prefixStats = new Map<string, { tried: number; hit: number }>()
  let consecutive429 = 0

  for (const stub of queue) {
    stats.fetched++
    const pfx = stub.prefix
    if (!prefixStats.has(pfx)) prefixStats.set(pfx, { tried: 0, hit: 0 })
    prefixStats.get(pfx)!.tried++

    let result = await fetchWorderyOffer(stub.isbn13)

    if (result === '429') {
      stats.rateLimit++
      consecutive429++
      if (consecutive429 >= MAX_429_ABORT) {
        console.error(`\n  ✗ ${MAX_429_ABORT} consecutive 429s — rate limit exhausted. Stopping early.`)
        console.error(`    Wait ~60 minutes before running again.\n`)
        break
      }
      console.warn(`    → backing off ${BACKOFF_MS / 1000}s then retrying...`)
      await new Promise(r => setTimeout(r, BACKOFF_MS))
      result = await fetchWorderyOffer(stub.isbn13)
    } else {
      consecutive429 = 0
    }

    if (result === '429') {
      console.log(`  ✗ 429 (retry failed) ${stub.isbn13}`)
      stats.errors++
    } else if (result === 'not_found') {
      console.log(`  ✗ not found  ${stub.isbn13}  [${pfx}]`)
      stats.notFound++
    } else if (result === null) {
      console.log(`  ✗ error      ${stub.isbn13}`)
      stats.errors++
    } else {
      consecutive429 = 0
      const { price, currency, availability } = result
      console.log(`  ✓ found      ${stub.isbn13}  ${currency} ${price.toFixed(2)}  [${availability}]  [${pfx}]`)
      prefixStats.get(pfx)!.hit++

      if (WRITE) {
        const priceStr = price.toFixed(2)
        const now = new Date()
        await prisma.retailerListing.update({
          where: { id: stub.id },
          data: { priceAmount: priceStr, priceCurrency: currency, stockStatus: availability, lastSeenAt: now, deletedAt: null },
        })
        await prisma.priceHistory.create({
          data: { retailerListingId: stub.id, priceAmount: priceStr, priceCurrency: currency, stockStatus: availability, recordedAt: now },
        })
        console.log(`    → written`)
      } else {
        console.log(`    → (dry-run)`)
      }
      stats.priced++
    }

    if (stats.fetched < queue.length) await new Promise(r => setTimeout(r, DELAY_MS))
  }

  // ── Step 5: Summary + prefix performance ─────────────────────────────────
  console.log('\n── Run Summary ──────────────────────────────────────────')
  console.log(`  Fetched    : ${stats.fetched}`)
  console.log(`  Priced     : ${stats.priced}  (${Math.round(stats.priced / stats.fetched * 100)}% hit rate this run)`)
  console.log(`  Not found  : ${stats.notFound}`)
  console.log(`  Rate limit : ${stats.rateLimit}  (429s)`)
  console.log(`  Errors     : ${stats.errors}`)

  console.log('\n── Prefix performance this run ──────────────────────────')
  for (const [pfx, s] of [...prefixStats.entries()].sort((a, b) => b[1].tried - a[1].tried)) {
    const pct = Math.round(s.hit / s.tried * 100)
    const historical = rateMap.get(pfx) ?? 0
    console.log(`  ${pfx}  tried=${s.tried}  hit=${s.hit}  (${pct}% this run, ${historical}% historical)`)
  }

  if (stats.rateLimit > 0) {
    console.log(`\n  ⚠ Rate limiting detected. Wait 60+ min before next batch.`)
  }
  if (DRY) console.log('\n  Run with --write to save prices.')

  // Post-run metrics
  if (WRITE && stats.priced > 0) {
    const [tmWordery, tmAny] = await Promise.all([
      prisma.$queryRaw<[{cnt:number}]>`
        SELECT COUNT(DISTINCT cp.id)::int AS cnt FROM canonical_products cp
        WHERE cp.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id
                      WHERE r.domain='travellingman.com' AND rl.canonical_product_id=cp.id AND rl.price_amount>0 AND rl.deleted_at IS NULL)
          AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id
                      WHERE r.domain='wordery.com' AND rl.canonical_product_id=cp.id AND rl.price_amount>0 AND rl.deleted_at IS NULL)
      `,
      prisma.$queryRaw<[{cnt:number}]>`
        SELECT COUNT(DISTINCT cp.id)::int AS cnt FROM canonical_products cp
        WHERE cp.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id
                      WHERE r.domain='travellingman.com' AND rl.canonical_product_id=cp.id AND rl.price_amount>0 AND rl.deleted_at IS NULL)
          AND (SELECT COUNT(DISTINCT rl2.retailer_id) FROM retailer_listings rl2
               WHERE rl2.canonical_product_id=cp.id AND rl2.price_amount>0 AND rl2.deleted_at IS NULL) >= 2
      `,
    ])
    console.log('\n── Post-run metrics ─────────────────────────────────────')
    console.log(`  TM + Wordery pages : ${tmWordery[0].cnt}`)
    console.log(`  Total real pages   : ${tmAny[0].cnt}`)
  }

  console.log('══════════════════════════════════════════════════════════\n')
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
