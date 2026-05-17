#!/usr/bin/env tsx
/**
 * Wordery — SMART Comic Price Enrichment
 *
 * Yield-optimised version of enrich-wordery-comics.ts.
 * Uses empirical prefix hit-rate data to:
 *   1. Skip confirmed dead prefixes (≥15 attempts, <5% hit rate)
 *   2. Prioritise high-yield prefixes first
 *   3. Treat unknown prefixes optimistically (assumed ~50%)
 *
 * This maximises real comparison-page gain per batch and per request,
 * reducing 429 exposure on dead ISBNs.
 *
 * Usage:
 *   npm run enrich:wordery:smart                        dry-run
 *   npm run enrich:wordery:smart -- --write
 *   npm run enrich:wordery:smart -- --limit 200 --write
 *   npm run enrich:wordery:smart -- --limit 200 --write --min-hit-rate 20
 */

import { prisma } from '../lib/prisma'
import { StockStatus } from '@prisma/client'

const args       = process.argv.slice(2)
const WRITE      = args.includes('--write')
const DRY        = !WRITE
const limIdx     = args.indexOf('--limit')
const LIMIT      = limIdx !== -1 ? parseInt(args[limIdx + 1] ?? '200', 10) : 200
const minHitIdx  = args.indexOf('--min-hit-rate')
// Dead prefix threshold — skip if ≥ MIN_ATTEMPTS and hit_rate < MIN_HIT_RATE
const MIN_HIT_RATE = minHitIdx !== -1 ? parseInt(args[minHitIdx + 1] ?? '5', 10) : 5
const MIN_ATTEMPTS_TO_SKIP = 15  // need enough data before declaring dead

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

const DELAY_MS      = 20_000   // 20s between requests = 180 req/hr
const BACKOFF_MS    = 90_000   // 429 backoff
const MAX_429_ABORT = 5        // abort after this many consecutive 429s

interface ExtractedOffer {
  price       : number
  currency    : string
  availability: StockStatus
}

function parseInertiaJson(html: string): ExtractedOffer | null {
  const marker = 'data-page="'
  const start  = html.indexOf(marker)
  if (start === -1) return null
  const valueStart = start + marker.length
  let valueEnd     = valueStart
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
  } catch {
    return null
  }
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
  console.log(' Wordery — SMART Comic Enrichment (yield-optimised)')
  console.log(` Mode          : ${DRY ? 'DRY-RUN (pass --write to save)' : 'WRITE'}`)
  console.log(` Limit         : ${LIMIT}`)
  console.log(` Dead threshold: <${MIN_HIT_RATE}% hit rate with ≥${MIN_ATTEMPTS_TO_SKIP} attempts → skip`)
  console.log('══════════════════════════════════════════════════════════\n')

  // Compute per-prefix hit rates across all Wordery stubs, then:
  //   - Exclude confirmed dead prefixes
  //   - Order by hit rate DESC (best bets first)
  //   - Unknown prefixes get est_hit_rate=50 (optimistic)
  const stubs = await prisma.$queryRaw<Array<{
    id: string
    isbn13: string
    est_hit_rate: number
    prefix_total: number
    prefix_priced: number
  }>>`
    WITH prefix_rates AS (
      SELECT
        LEFT(rl.isbn_13, 7)                                   AS prefix,
        COUNT(*)::int                                          AS total,
        COUNT(CASE WHEN rl.price_amount > 0 THEN 1 END)::int  AS priced,
        ROUND(
          COUNT(CASE WHEN rl.price_amount > 0 THEN 1 END)::numeric
          / NULLIF(COUNT(*), 0) * 100, 1
        )                                                      AS hit_rate
      FROM retailer_listings rl
      JOIN retailers r ON r.id = rl.retailer_id
      WHERE r.domain = 'wordery.com'
        AND rl.deleted_at IS NULL
        AND rl.isbn_13 IS NOT NULL
      GROUP BY LEFT(rl.isbn_13, 7)
    )
    SELECT
      rl.id,
      rl.isbn_13                          AS isbn13,
      COALESCE(pr.hit_rate, 50)::int      AS est_hit_rate,
      COALESCE(pr.total, 0)::int          AS prefix_total,
      COALESCE(pr.priced, 0)::int         AS prefix_priced
    FROM retailer_listings rl
    JOIN retailers r ON r.id = rl.retailer_id
    LEFT JOIN prefix_rates pr ON pr.prefix = LEFT(rl.isbn_13, 7)
    WHERE r.domain = 'wordery.com'
      AND rl.deleted_at IS NULL
      AND rl.price_amount <= 0
      AND rl.isbn_13 IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM   retailer_listings tm_rl
        JOIN   retailers tm_r ON tm_r.id = tm_rl.retailer_id
        WHERE  tm_r.domain = 'travellingman.com'
          AND  tm_rl.canonical_product_id = rl.canonical_product_id
          AND  tm_rl.deleted_at IS NULL
          AND  tm_rl.price_amount > 0
      )
      -- Exclude confirmed dead prefixes: enough data, consistently fails
      AND NOT (
        COALESCE(pr.total, 0) >= ${MIN_ATTEMPTS_TO_SKIP}
        AND COALESCE(pr.hit_rate, 100) < ${MIN_HIT_RATE}
      )
    ORDER BY
      COALESCE(pr.hit_rate, 50) DESC,   -- high-yield first
      rl.first_seen_at ASC               -- within tier: oldest unstale stubs
    LIMIT ${LIMIT}
  `

  if (stubs.length === 0) {
    console.log('  No eligible stubs found (all remaining may be dead-pool).')
    console.log(`  Try lowering --min-hit-rate (currently ${MIN_HIT_RATE}%) or run the cohort analysis.\n`)
    return
  }

  // Show prefix distribution of selected batch
  const prefixMap = new Map<string, { count: number; est: number }>()
  for (const s of stubs) {
    const prefix = s.isbn13.slice(0, 7)
    const existing = prefixMap.get(prefix) ?? { count: 0, est: s.est_hit_rate }
    prefixMap.set(prefix, { count: existing.count + 1, est: existing.est })
  }
  const topPrefixes = [...prefixMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)

  console.log(`  Selected ${stubs.length} stubs (yield-optimised batch)\n`)
  console.log(`  Top prefixes in this batch:`)
  for (const [p, { count, est }] of topPrefixes) {
    const bar = est >= 60 ? '●●●' : est >= 30 ? '●●○' : est >= 10 ? '●○○' : '○○○'
    console.log(`    ${p}  ${String(count).padStart(3)} stubs  est ${String(est).padStart(3)}% ${bar}`)
  }
  const avgEst = Math.round(stubs.reduce((s, r) => s + r.est_hit_rate, 0) / stubs.length)
  console.log(`\n  Batch estimated yield: ~${avgEst}%  → ~${Math.round(stubs.length * avgEst / 100)} new prices\n`)

  const stats = { fetched: 0, priced: 0, notFound: 0, errors: 0, rateLimit: 0 }
  let consecutive429 = 0

  for (const stub of stubs) {
    const isbn = stub.isbn13
    stats.fetched++

    let result = await fetchWorderyOffer(isbn)

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
      result = await fetchWorderyOffer(isbn)
    } else {
      consecutive429 = 0
    }

    if (result === '429') {
      console.log(`  ✗ 429 (retry failed) ${isbn}`)
      stats.errors++
    } else if (result === 'not_found') {
      console.log(`  ✗ not found  ${isbn}`)
      stats.notFound++
    } else if (result === null) {
      console.log(`  ✗ error      ${isbn}`)
      stats.errors++
    } else {
      consecutive429 = 0
      const { price, currency, availability } = result
      console.log(`  ✓ found      ${isbn}  ${currency} ${price.toFixed(2)}  [${availability}]`)

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

    if (stats.fetched < stubs.length) await new Promise(r => setTimeout(r, DELAY_MS))
  }

  const actualYield = stats.fetched > 0 ? Math.round(stats.priced / stats.fetched * 100) : 0
  const efficiency  = stats.fetched > 0 ? Math.round((stats.priced) / stats.fetched * 100) : 0

  console.log('\n── Summary ──────────────────────────────────────────────')
  console.log(`  Fetched      : ${stats.fetched}`)
  console.log(`  Priced       : ${stats.priced}  (${actualYield}% actual yield)`)
  console.log(`  Not found    : ${stats.notFound}  (${stats.fetched > 0 ? Math.round(stats.notFound / stats.fetched * 100) : 0}%)`)
  console.log(`  Rate limit   : ${stats.rateLimit}  (429s — backed off and retried)`)
  console.log(`  Errors       : ${stats.errors}`)
  console.log(`  Est vs actual: ${avgEst}% predicted → ${actualYield}% actual`)
  if (stats.rateLimit > 0) {
    console.log(`\n  ⚠ Rate limiting detected. Wait 60+ minutes before next batch.`)
    console.log(`    Next safe batch: npm run enrich:wordery:smart -- --limit 200 --write`)
  } else {
    console.log(`\n  ✓ No rate limiting. Recommended cooldown: 60 min before next batch.`)
    console.log(`    Next safe batch: npm run enrich:wordery:smart -- --limit 200 --write`)
  }
  if (DRY) console.log('\n  Run with --write to save prices.')
  console.log('══════════════════════════════════════════════════════════\n')
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
