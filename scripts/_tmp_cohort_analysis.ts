/**
 * Wordery Enrichment Cohort Analysis
 * Analyses hit/miss rates by ISBN prefix (publisher), format, price band.
 * READ ONLY.
 */
import { prisma } from '../lib/prisma'

async function main() {
  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' WORDERY COHORT ANALYSIS — Publisher Hit Rate Breakdown')
  console.log('══════════════════════════════════════════════════════════\n')

  // ── 1. ISBN prefix hit rate (publisher signal) ────────────────────────────
  // Group by first 7 digits of ISBN-13 (publisher + imprint level)
  const prefixStats = await prisma.$queryRaw<Array<{
    prefix: string
    total: number
    priced: number
    hit_rate: number
    avg_price: string
    sample_title: string
  }>>`
    SELECT
      LEFT(rl.isbn_13, 7)                              AS prefix,
      COUNT(*)::int                                     AS total,
      COUNT(CASE WHEN rl.price_amount > 0 THEN 1 END)::int AS priced,
      ROUND(
        COUNT(CASE WHEN rl.price_amount > 0 THEN 1 END)::numeric
        / NULLIF(COUNT(*), 0) * 100, 1
      )                                                 AS hit_rate,
      ROUND(AVG(CASE WHEN rl.price_amount > 0 THEN rl.price_amount END)::numeric, 2)::text AS avg_price,
      MIN(cp.title)                                     AS sample_title
    FROM retailer_listings rl
    JOIN retailers r ON r.id = rl.retailer_id
    JOIN canonical_products cp ON cp.id = rl.canonical_product_id
    WHERE r.domain = 'wordery.com'
      AND rl.deleted_at IS NULL
      AND rl.isbn_13 IS NOT NULL
      AND cp.deleted_at IS NULL
    GROUP BY LEFT(rl.isbn_13, 7)
    HAVING COUNT(*) >= 3
    ORDER BY COUNT(*) DESC
    LIMIT 50
  `

  console.log('── ISBN Prefix Hit Rates (≥3 stubs, by volume) ─────────────')
  console.log(`  ${'Prefix'.padEnd(9)} ${'Total'.padStart(5)} ${'Priced'.padStart(6)} ${'Hit%'.padStart(5)} ${'AvgPrice'.padStart(9)}  Sample title`)
  console.log(`  ${'─'.repeat(9)} ${'─'.repeat(5)} ${'─'.repeat(6)} ${'─'.repeat(5)} ${'─'.repeat(9)}  ${'─'.repeat(30)}`)
  for (const r of prefixStats) {
    const hitPct = r.hit_rate?.toString() ?? '0'
    const bar = hitPct === '0' ? '░░░░░' : hitPct >= 90 ? '█████' : hitPct >= 70 ? '████░' : hitPct >= 50 ? '███░░' : hitPct >= 30 ? '██░░░' : '█░░░░'
    console.log(`  ${r.prefix.padEnd(9)} ${String(r.total).padStart(5)} ${String(r.priced).padStart(6)} ${String(hitPct).padStart(4)}% ${bar}  £${(r.avg_price ?? '—').padStart(6)}  ${r.sample_title?.slice(0, 40) ?? ''}`)
  }

  // ── 2. Format breakdown of priced vs unpriced ─────────────────────────────
  const formatStats = await prisma.$queryRaw<Array<{
    format: string; total: number; priced: number; hit_rate: number
  }>>`
    SELECT
      cp.format::text,
      COUNT(*)::int                                      AS total,
      COUNT(CASE WHEN rl.price_amount > 0 THEN 1 END)::int AS priced,
      ROUND(COUNT(CASE WHEN rl.price_amount > 0 THEN 1 END)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS hit_rate
    FROM retailer_listings rl
    JOIN retailers r ON r.id = rl.retailer_id
    JOIN canonical_products cp ON cp.id = rl.canonical_product_id
    WHERE r.domain = 'wordery.com'
      AND rl.deleted_at IS NULL
      AND rl.isbn_13 IS NOT NULL
      AND cp.deleted_at IS NULL
    GROUP BY cp.format
    ORDER BY COUNT(*) DESC
  `

  console.log('\n── Format Hit Rates ─────────────────────────────────────────')
  console.log(`  ${'Format'.padEnd(22)} ${'Total'.padStart(6)} ${'Priced'.padStart(7)} ${'Hit%'.padStart(6)}`)
  for (const f of formatStats) {
    console.log(`  ${f.format.padEnd(22)} ${String(f.total).padStart(6)} ${String(f.priced).padStart(7)} ${String(f.hit_rate ?? 0).padStart(5)}%`)
  }

  // ── 3. TM-linked stubs: hit rate by prefix (the enrichment queue) ─────────
  const tmLinkedPrefixStats = await prisma.$queryRaw<Array<{
    prefix: string
    total: number
    priced: number
    hit_rate: number
    sample_title: string
  }>>`
    SELECT
      LEFT(rl.isbn_13, 7) AS prefix,
      COUNT(*)::int AS total,
      COUNT(CASE WHEN rl.price_amount > 0 THEN 1 END)::int AS priced,
      ROUND(COUNT(CASE WHEN rl.price_amount > 0 THEN 1 END)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS hit_rate,
      MIN(cp.title) AS sample_title
    FROM retailer_listings rl
    JOIN retailers r ON r.id = rl.retailer_id
    JOIN canonical_products cp ON cp.id = rl.canonical_product_id
    WHERE r.domain = 'wordery.com'
      AND rl.deleted_at IS NULL
      AND rl.isbn_13 IS NOT NULL
      AND cp.deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM retailer_listings tm
        JOIN retailers tmr ON tmr.id = tm.retailer_id
        WHERE tmr.domain = 'travellingman.com'
          AND tm.canonical_product_id = rl.canonical_product_id
          AND tm.deleted_at IS NULL
          AND tm.price_amount > 0
      )
    GROUP BY LEFT(rl.isbn_13, 7)
    HAVING COUNT(*) >= 2
    ORDER BY COUNT(*) DESC
    LIMIT 40
  `

  console.log('\n── TM-Linked Stub Hit Rates by Prefix (the enrichment queue) ─')
  console.log(`  ${'Prefix'.padEnd(9)} ${'Total'.padStart(5)} ${'Priced'.padStart(6)} ${'Unpriced'.padStart(9)} ${'Hit%'.padStart(5)}  Sample title`)
  console.log(`  ${'─'.repeat(9)} ${'─'.repeat(5)} ${'─'.repeat(6)} ${'─'.repeat(9)} ${'─'.repeat(5)}  ${'─'.repeat(35)}`)
  for (const r of tmLinkedPrefixStats) {
    const unpriced = r.total - r.priced
    const hitPct = r.hit_rate ?? 0
    const tier = hitPct >= 80 ? 'HIGH ' : hitPct >= 40 ? 'MED  ' : hitPct > 0 ? 'LOW  ' : 'ZERO '
    console.log(`  ${r.prefix.padEnd(9)} ${String(r.total).padStart(5)} ${String(r.priced).padStart(6)} ${String(unpriced).padStart(9)} ${String(hitPct).padStart(4)}%  [${tier}] ${r.sample_title?.slice(0, 30) ?? ''}`)
  }

  // ── 4. High-yield unpriced pool: TM-linked, unpriced, high-hit-rate prefixes
  const highYieldUnpriced = await prisma.$queryRaw<Array<{
    prefix: string; unpriced_count: number; hit_rate: number; sample_title: string
  }>>`
    WITH prefix_rates AS (
      SELECT
        LEFT(rl.isbn_13, 7) AS prefix,
        ROUND(COUNT(CASE WHEN rl.price_amount > 0 THEN 1 END)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS hit_rate
      FROM retailer_listings rl
      JOIN retailers r ON r.id = rl.retailer_id
      WHERE r.domain = 'wordery.com' AND rl.deleted_at IS NULL AND rl.isbn_13 IS NOT NULL
      GROUP BY LEFT(rl.isbn_13, 7)
      HAVING COUNT(*) >= 3
    )
    SELECT
      LEFT(rl.isbn_13, 7) AS prefix,
      COUNT(*)::int AS unpriced_count,
      pr.hit_rate,
      MIN(cp.title) AS sample_title
    FROM retailer_listings rl
    JOIN retailers r ON r.id = rl.retailer_id
    JOIN canonical_products cp ON cp.id = rl.canonical_product_id
    JOIN prefix_rates pr ON pr.prefix = LEFT(rl.isbn_13, 7)
    WHERE r.domain = 'wordery.com'
      AND rl.deleted_at IS NULL
      AND rl.price_amount <= 0
      AND rl.isbn_13 IS NOT NULL
      AND cp.deleted_at IS NULL
      AND pr.hit_rate >= 60
      AND EXISTS (
        SELECT 1 FROM retailer_listings tm
        JOIN retailers tmr ON tmr.id = tm.retailer_id
        WHERE tmr.domain = 'travellingman.com'
          AND tm.canonical_product_id = rl.canonical_product_id
          AND tm.deleted_at IS NULL AND tm.price_amount > 0
      )
    GROUP BY LEFT(rl.isbn_13, 7), pr.hit_rate
    ORDER BY pr.hit_rate DESC, COUNT(*) DESC
  `

  console.log('\n── HIGH-YIELD UNPRICED POOL (TM-linked, hit_rate ≥ 60%) ────')
  console.log(`  ${'Prefix'.padEnd(9)} ${'Unpriced'.padStart(9)} ${'Hit%'.padStart(6)}  Sample title`)
  let totalHighYield = 0
  for (const r of highYieldUnpriced) {
    totalHighYield += r.unpriced_count
    console.log(`  ${r.prefix.padEnd(9)} ${String(r.unpriced_count).padStart(9)} ${String(r.hit_rate ?? 0).padStart(5)}%  ${r.sample_title?.slice(0, 40) ?? ''}`)
  }
  console.log(`\n  Total high-yield unpriced stubs: ${totalHighYield.toLocaleString()}`)
  console.log(`  At 200/batch × avg ~75% hit rate: ~${Math.ceil(totalHighYield / 200)} batches, ~${Math.round(totalHighYield * 0.75)} new prices`)

  // ── 5. Dead pool: zero-hit prefixes with large unpriced counts ────────────
  const deadPool = await prisma.$queryRaw<Array<{
    prefix: string; unpriced_count: number; hit_rate: number; sample_title: string
  }>>`
    WITH prefix_rates AS (
      SELECT
        LEFT(rl.isbn_13, 7) AS prefix,
        ROUND(COUNT(CASE WHEN rl.price_amount > 0 THEN 1 END)::numeric / NULLIF(COUNT(*), 0) * 100, 1) AS hit_rate
      FROM retailer_listings rl
      JOIN retailers r ON r.id = rl.retailer_id
      WHERE r.domain = 'wordery.com' AND rl.deleted_at IS NULL AND rl.isbn_13 IS NOT NULL
      GROUP BY LEFT(rl.isbn_13, 7)
      HAVING COUNT(*) >= 5
    )
    SELECT
      LEFT(rl.isbn_13, 7) AS prefix,
      COUNT(*)::int AS unpriced_count,
      pr.hit_rate,
      MIN(cp.title) AS sample_title
    FROM retailer_listings rl
    JOIN retailers r ON r.id = rl.retailer_id
    JOIN canonical_products cp ON cp.id = rl.canonical_product_id
    JOIN prefix_rates pr ON pr.prefix = LEFT(rl.isbn_13, 7)
    WHERE r.domain = 'wordery.com'
      AND rl.deleted_at IS NULL
      AND rl.price_amount <= 0
      AND rl.isbn_13 IS NOT NULL
      AND cp.deleted_at IS NULL
      AND pr.hit_rate < 15
      AND EXISTS (
        SELECT 1 FROM retailer_listings tm
        JOIN retailers tmr ON tmr.id = tm.retailer_id
        WHERE tmr.domain = 'travellingman.com'
          AND tm.canonical_product_id = rl.canonical_product_id
          AND tm.deleted_at IS NULL AND tm.price_amount > 0
      )
    GROUP BY LEFT(rl.isbn_13, 7), pr.hit_rate
    ORDER BY COUNT(*) DESC
    LIMIT 20
  `

  console.log('\n── DEAD POOL (TM-linked unpriced, hit_rate < 15%) ───────────')
  console.log('  (skip these — Wordery doesn\'t stock them)\n')
  let totalDead = 0
  for (const r of deadPool) {
    totalDead += r.unpriced_count
    console.log(`  ${r.prefix.padEnd(9)} ${String(r.unpriced_count).padStart(6)} unpriced  ${String(r.hit_rate ?? 0).padStart(4)}% hit  ${r.sample_title?.slice(0, 35) ?? ''}`)
  }
  console.log(`\n  Total low-yield unpriced stubs: ${totalDead.toLocaleString()}`)

  console.log('\n══════════════════════════════════════════════════════════\n')
}

main().catch(console.error).finally(() => prisma.$disconnect())
