#!/usr/bin/env tsx
/**
 * Catch Comics — Operating Dashboard v2
 *
 * Real TM-anchored metrics only. No inflated counts.
 * Run any time to get current state.
 *
 * Usage: npm run dashboard
 */
import { prisma } from '../lib/prisma'

async function main() {
  const now = new Date()
  console.log('\n══════════════════════════════════════════════════════════════════')
  console.log(' CATCH COMICS — OPERATING DASHBOARD v2')
  console.log(` ${now.toISOString()}`)
  console.log('══════════════════════════════════════════════════════════════════\n')

  const [
    tmAny, tmWordery, tmBookshop, tmWob,
    threeRetailer, fourRetailer,
    worderyTotal, worderyPriced, worderyUnpricedTmLinked,
    bookshopTotal, bookshopPriced,
    wobVisible,
    prefixStats,
    bestPages,
    recentlyAdded,
    enrichmentHistory,
    retailerHealth,
  ] = await Promise.all([

    // ── Real comparison pages ────────────────────────────────────────────────
    prisma.$queryRaw<[{cnt:number}]>`
      SELECT COUNT(DISTINCT cp.id)::int AS cnt FROM canonical_products cp
      WHERE cp.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id
                    WHERE r.domain='travellingman.com' AND rl.canonical_product_id=cp.id AND rl.price_amount>0 AND rl.deleted_at IS NULL)
        AND (SELECT COUNT(DISTINCT rl2.retailer_id) FROM retailer_listings rl2
             WHERE rl2.canonical_product_id=cp.id AND rl2.price_amount>0 AND rl2.deleted_at IS NULL) >= 2`,

    prisma.$queryRaw<[{cnt:number}]>`
      SELECT COUNT(DISTINCT cp.id)::int AS cnt FROM canonical_products cp WHERE cp.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id WHERE r.domain='travellingman.com' AND rl.canonical_product_id=cp.id AND rl.price_amount>0 AND rl.deleted_at IS NULL)
        AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id WHERE r.domain='wordery.com' AND rl.canonical_product_id=cp.id AND rl.price_amount>0 AND rl.deleted_at IS NULL)`,

    prisma.$queryRaw<[{cnt:number}]>`
      SELECT COUNT(DISTINCT cp.id)::int AS cnt FROM canonical_products cp WHERE cp.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id WHERE r.domain='travellingman.com' AND rl.canonical_product_id=cp.id AND rl.price_amount>0 AND rl.deleted_at IS NULL)
        AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id WHERE r.domain='uk.bookshop.org' AND rl.canonical_product_id=cp.id AND rl.price_amount>0 AND rl.deleted_at IS NULL)`,

    prisma.$queryRaw<[{cnt:number}]>`
      SELECT COUNT(DISTINCT cp.id)::int AS cnt FROM canonical_products cp WHERE cp.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id WHERE r.domain='travellingman.com' AND rl.canonical_product_id=cp.id AND rl.price_amount>0 AND rl.deleted_at IS NULL)
        AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id WHERE r.domain='worldofbooks.com' AND rl.canonical_product_id=cp.id AND rl.price_amount>0 AND rl.deleted_at IS NULL)`,

    prisma.$queryRaw<[{cnt:number}]>`
      SELECT COUNT(DISTINCT cp.id)::int AS cnt FROM canonical_products cp WHERE cp.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id WHERE r.domain='travellingman.com' AND rl.canonical_product_id=cp.id AND rl.price_amount>0 AND rl.deleted_at IS NULL)
        AND (SELECT COUNT(DISTINCT rl2.retailer_id) FROM retailer_listings rl2 WHERE rl2.canonical_product_id=cp.id AND rl2.price_amount>0 AND rl2.deleted_at IS NULL) >= 3`,

    prisma.$queryRaw<[{cnt:number}]>`
      SELECT COUNT(DISTINCT cp.id)::int AS cnt FROM canonical_products cp WHERE cp.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id WHERE r.domain='travellingman.com' AND rl.canonical_product_id=cp.id AND rl.price_amount>0 AND rl.deleted_at IS NULL)
        AND (SELECT COUNT(DISTINCT rl2.retailer_id) FROM retailer_listings rl2 WHERE rl2.canonical_product_id=cp.id AND rl2.price_amount>0 AND rl2.deleted_at IS NULL) >= 4`,

    // ── Wordery pipeline ─────────────────────────────────────────────────────
    prisma.retailerListing.count({ where: { retailer: { domain: 'wordery.com' }, deletedAt: null } }),
    prisma.retailerListing.count({ where: { retailer: { domain: 'wordery.com' }, priceAmount: { gt: 0 }, deletedAt: null } }),
    prisma.$queryRaw<[{cnt:number}]>`
      SELECT COUNT(*)::int AS cnt FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id
      WHERE r.domain='wordery.com' AND rl.deleted_at IS NULL AND rl.price_amount<=0 AND rl.isbn_13 IS NOT NULL
        AND EXISTS (SELECT 1 FROM retailer_listings tm JOIN retailers tmr ON tmr.id=tm.retailer_id
                    WHERE tmr.domain='travellingman.com' AND tm.canonical_product_id=rl.canonical_product_id
                    AND tm.deleted_at IS NULL AND tm.price_amount>0)`,

    // ── Bookshop pipeline ────────────────────────────────────────────────────
    prisma.retailerListing.count({ where: { retailer: { domain: 'uk.bookshop.org' }, deletedAt: null } }),
    prisma.retailerListing.count({ where: { retailer: { domain: 'uk.bookshop.org' }, priceAmount: { gt: 0 }, deletedAt: null } }),

    // ── WoB ──────────────────────────────────────────────────────────────────
    prisma.retailerListing.count({ where: { retailer: { domain: 'worldofbooks.com' }, canonicalProductId: { not: null }, priceAmount: { gt: 0 }, deletedAt: null } }),

    // ── Per-prefix stats: yield intelligence ─────────────────────────────────
    prisma.$queryRaw<Array<{prefix:string;total:number;priced:number;hit_rate:number;tier:string}>>`
      SELECT
        LEFT(rl.isbn_13, 7) AS prefix,
        COUNT(*)::int AS total,
        COUNT(CASE WHEN rl.price_amount > 0 THEN 1 END)::int AS priced,
        ROUND(COUNT(CASE WHEN rl.price_amount > 0 THEN 1 END)::numeric / NULLIF(COUNT(*),0)*100,1) AS hit_rate,
        CASE
          WHEN ROUND(COUNT(CASE WHEN rl.price_amount > 0 THEN 1 END)::numeric / NULLIF(COUNT(*),0)*100,1) >= 60 THEN 'HIGH'
          WHEN ROUND(COUNT(CASE WHEN rl.price_amount > 0 THEN 1 END)::numeric / NULLIF(COUNT(*),0)*100,1) >= 30 THEN 'MED'
          WHEN ROUND(COUNT(CASE WHEN rl.price_amount > 0 THEN 1 END)::numeric / NULLIF(COUNT(*),0)*100,1) >= 10 THEN 'LOW'
          ELSE 'DEAD'
        END AS tier
      FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id
      WHERE r.domain='wordery.com' AND rl.deleted_at IS NULL AND rl.isbn_13 IS NOT NULL
      GROUP BY LEFT(rl.isbn_13,7) HAVING COUNT(*)>=5
      ORDER BY COUNT(*) DESC LIMIT 25`,

    // ── Best live pages ───────────────────────────────────────────────────────
    prisma.$queryRaw<Array<{title:string;slug:string;cnt:number;prices:string}>>`
      SELECT cp.title, cp.canonical_slug AS slug,
        COUNT(DISTINCT rl.retailer_id)::int AS cnt,
        STRING_AGG(r.domain||':£'||rl.price_amount::text, ' | ' ORDER BY rl.price_amount ASC) AS prices
      FROM canonical_products cp
      JOIN retailer_listings rl ON rl.canonical_product_id=cp.id
      JOIN retailers r ON r.id=rl.retailer_id
      WHERE cp.deleted_at IS NULL AND rl.deleted_at IS NULL AND rl.price_amount>0
        AND EXISTS (SELECT 1 FROM retailer_listings t JOIN retailers tr ON tr.id=t.retailer_id
                    WHERE tr.domain='travellingman.com' AND t.canonical_product_id=cp.id AND t.price_amount>0 AND t.deleted_at IS NULL)
      GROUP BY cp.id, cp.title, cp.canonical_slug
      HAVING COUNT(DISTINCT rl.retailer_id)>=3
      ORDER BY cnt DESC, cp.title ASC LIMIT 5`,

    // ── Recently gained (last 24h) ────────────────────────────────────────────
    prisma.$queryRaw<[{cnt:number}]>`
      SELECT COUNT(DISTINCT rl.canonical_product_id)::int AS cnt
      FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id
      WHERE r.domain='wordery.com' AND rl.price_amount>0 AND rl.deleted_at IS NULL
        AND rl.last_seen_at >= NOW() - INTERVAL '24 hours'
        AND EXISTS (SELECT 1 FROM retailer_listings tm JOIN retailers tmr ON tmr.id=tm.retailer_id
                    WHERE tmr.domain='travellingman.com' AND tm.canonical_product_id=rl.canonical_product_id
                    AND tm.deleted_at IS NULL AND tm.price_amount>0)`,

    // ── Enrichment velocity (last 7 days) ────────────────────────────────────
    prisma.$queryRaw<Array<{day:string;cnt:number}>>`
      SELECT TO_CHAR(DATE_TRUNC('day', rl.last_seen_at), 'MM-DD') AS day, COUNT(*)::int AS cnt
      FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id
      WHERE r.domain='wordery.com' AND rl.price_amount>0 AND rl.deleted_at IS NULL
        AND rl.last_seen_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE_TRUNC('day', rl.last_seen_at)
      ORDER BY DATE_TRUNC('day', rl.last_seen_at) ASC`,

    // ── Retailer health ───────────────────────────────────────────────────────
    prisma.$queryRaw<Array<{domain:string;total:number;priced:number;canon:number;pct:number}>>`
      SELECT r.domain,
        COUNT(*)::int AS total,
        COUNT(CASE WHEN rl.price_amount>0 THEN 1 END)::int AS priced,
        COUNT(CASE WHEN rl.canonical_product_id IS NOT NULL AND rl.price_amount>0 THEN 1 END)::int AS canon,
        ROUND(COUNT(CASE WHEN rl.price_amount>0 THEN 1 END)::numeric / NULLIF(COUNT(*),0)*100,1)::int AS pct
      FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id
      WHERE rl.deleted_at IS NULL
      GROUP BY r.domain
      ORDER BY COUNT(*) DESC`,
  ])

  // ── Computed metrics ─────────────────────────────────────────────────────
  const currentPages   = tmAny[0].cnt
  const tmLinked       = worderyUnpricedTmLinked[0].cnt
  const pagesGained    = recentlyAdded[0].cnt

  // Effective yield: high-yield unpriced stubs (exclude dead prefixes)
  const deadPrefixes   = prefixStats.filter(p => p.tier === 'DEAD' && p.total >= 15)
  const deadPrefixSet  = new Set(deadPrefixes.map(p => p.prefix))
  const highYieldStats = prefixStats.filter(p => p.tier !== 'DEAD')
  const overallHitRate = prefixStats.length > 0
    ? Math.round(prefixStats.reduce((s,p) => s + (p.priced ?? 0), 0) / prefixStats.reduce((s,p) => s + (p.total ?? 0), 0) * 100)
    : 0
  const smartHitRate   = highYieldStats.length > 0
    ? Math.round(highYieldStats.reduce((s,p) => s + (p.priced ?? 0), 0) / highYieldStats.reduce((s,p) => s + (p.total ?? 0), 0) * 100)
    : 0

  // Batches to milestones
  const effectiveYieldPct = smartHitRate / 100
  const batchSize = 200
  const pagesPerBatch = Math.max(1, Math.round(batchSize * effectiveYieldPct))
  const pagesTo1000  = Math.max(0, 1000  - currentPages)
  const pagesTo2500  = Math.max(0, 2500  - currentPages)
  const pagesTo5000  = Math.max(0, 5000  - currentPages)
  const batchesTo1000 = Math.ceil(pagesTo1000 / pagesPerBatch)
  const batchesTo2500 = Math.ceil(pagesTo2500 / pagesPerBatch)
  const batchesTo5000 = Math.ceil(pagesTo5000 / pagesPerBatch)

  // Launch readiness (rough heuristic)
  const launchReadinessPct = Math.min(100, Math.round(
    (Math.min(currentPages, 500) / 500) * 40 +   // page count (40pts)
    (threeRetailer[0].cnt > 50 ? 20 : threeRetailer[0].cnt / 50 * 20) +  // 3+ retailers (20pts)
    (worderyPriced > 500 ? 15 : worderyPriced / 500 * 15) +  // Wordery depth (15pts)
    (bookshopPriced > 100 ? 10 : bookshopPriced / 100 * 10) + // Bookshop (10pts)
    15  // baseline (infrastructure working)
  ))

  // ── Print ─────────────────────────────────────────────────────────────────
  console.log('── REAL COMIC COMPARISON PAGES (TM-anchored) ──────────────────')
  console.log(`  TM + any 1 other           : ${currentPages.toLocaleString().padStart(5)}  ← THE NUMBER`)
  console.log(`  TM + Wordery               : ${tmWordery[0].cnt.toLocaleString().padStart(5)}`)
  console.log(`  TM + Bookshop UK           : ${tmBookshop[0].cnt.toLocaleString().padStart(5)}`)
  console.log(`  TM + WoB                   : ${tmWob[0].cnt.toLocaleString().padStart(5)}`)
  console.log(`  3+ retailers               : ${threeRetailer[0].cnt.toLocaleString().padStart(5)}`)
  console.log(`  4+ retailers               : ${fourRetailer[0].cnt.toLocaleString().padStart(5)}`)
  console.log(`\n  Pages gained (last 24h)    : +${pagesGained}`)
  console.log(`\n── MILESTONE PROJECTIONS (smart batches, ${pagesPerBatch} pages/batch est) ──`)
  console.log(`  To 1,000 pages  : ${currentPages >= 1000  ? '✓ DONE' : `~${batchesTo1000} batches  (~${Math.round(batchesTo1000 * 1.5)}h at 90min cadence)`}`)
  console.log(`  To 2,500 pages  : ${currentPages >= 2500  ? '✓ DONE' : `~${batchesTo2500} batches  (~${Math.round(batchesTo2500 * 1.5)}h)`}`)
  console.log(`  To 5,000 pages  : ${currentPages >= 5000  ? '✓ DONE' : `~${batchesTo5000} batches  (~${Math.round(batchesTo5000 * 1.5)}h)`}`)

  console.log('\n── LAUNCH READINESS ────────────────────────────────────────────')
  const bar = '█'.repeat(Math.round(launchReadinessPct / 5)) + '░'.repeat(20 - Math.round(launchReadinessPct / 5))
  console.log(`  ${bar} ${launchReadinessPct}%`)
  console.log(`  Blockers: ${currentPages < 200 ? '❌ page count' : '✓'} ${threeRetailer[0].cnt < 50 ? '❌ retailer density' : '✓'} ${bookshopPriced < 50 ? '⚠ bookshop depth' : '✓'}`)

  console.log('\n── WORDERY ENRICHMENT ENGINE ───────────────────────────────────')
  const worderyPct = Math.round(worderyPriced / worderyTotal * 100)
  const batchesLeft = Math.ceil(tmLinked / 200)
  console.log(`  Total stubs                : ${worderyTotal.toLocaleString()}`)
  console.log(`  Priced                     : ${worderyPriced.toLocaleString()}  (${worderyPct}%)`)
  console.log(`  TM-linked & unpriced       : ${tmLinked.toLocaleString()}  ← queue`)
  console.log(`  Dead prefixes (skip)       : ${deadPrefixes.length} prefixes  (${deadPrefixes.map(p=>p.prefix).slice(0,5).join(', ')}${deadPrefixes.length > 5 ? '…' : ''})`)
  console.log(`  Smart yield (non-dead)     : ~${smartHitRate}%  vs raw ${overallHitRate}%`)
  console.log(`  Raw batches remaining      : ~${batchesLeft}`)
  console.log(`  Est. new pages @ smart rate: ~${Math.round(tmLinked * effectiveYieldPct * 0.8)}`)

  console.log('\n── ENRICHMENT VELOCITY (last 7 days) ───────────────────────────')
  if (enrichmentHistory.length === 0) {
    console.log('  No data yet.')
  } else {
    for (const day of enrichmentHistory) {
      const spark = '█'.repeat(Math.min(40, Math.round(day.cnt / 5)))
      console.log(`  ${day.day}  ${spark}  ${day.cnt}`)
    }
  }

  console.log('\n── BOOKSHOP UK PIPELINE ───────────────────────────────────────')
  const bkPct = Math.round(bookshopPriced / bookshopTotal * 100)
  console.log(`  Total stubs                : ${bookshopTotal.toLocaleString()}`)
  console.log(`  Priced                     : ${bookshopPriced.toLocaleString()}  (${bkPct}%)`)
  console.log(`  TM overlap potential       : (run enrich:bookshop to check)`)

  console.log('\n── WORLD OF BOOKS ─────────────────────────────────────────────')
  console.log(`  Visible (priced+matched)   : ${wobVisible.toLocaleString()}`)
  console.log(`  TM overlap                 : 0  (catalog mismatch — structural)`)

  console.log('\n── RETAILER HEALTH ────────────────────────────────────────────')
  console.log(`  ${'Domain'.padEnd(25)} ${'Total'.padStart(6)} ${'Priced'.padStart(7)} ${'Matched'.padStart(8)} ${'%'.padStart(4)}`)
  for (const r of retailerHealth) {
    const status = r.priced > 0 ? '✓' : '⚠'
    console.log(`  ${status} ${r.domain.padEnd(23)} ${String(r.total).padStart(6)} ${String(r.priced).padStart(7)} ${String(r.canon).padStart(8)} ${String(r.pct).padStart(3)}%`)
  }

  console.log('\n── YIELD INTELLIGENCE — PREFIX PERFORMANCE ─────────────────────')
  console.log(`  ${'Prefix'.padEnd(9)} ${'Stubs'.padStart(5)} ${'Priced'.padStart(6)} ${'Hit%'.padStart(5)} ${'Tier'.padStart(5)}`)
  for (const p of prefixStats) {
    const bar = p.tier === 'HIGH' ? '●●●' : p.tier === 'MED' ? '●●○' : p.tier === 'LOW' ? '●○○' : '○○○'
    const dead = deadPrefixSet.has(p.prefix) ? ' ← SKIP' : ''
    console.log(`  ${p.prefix.padEnd(9)} ${String(p.total).padStart(5)} ${String(p.priced).padStart(6)} ${String(p.hit_rate ?? 0).padStart(4)}% ${bar}${dead}`)
  }
  console.log(`\n  Dead prefixes skipped in smart batches: ${deadPrefixes.length}`)
  console.log(`  Effective smart yield: ~${smartHitRate}% (vs ${overallHitRate}% raw)`)

  if (bestPages.length > 0) {
    console.log('\n── BEST LIVE PAGES (3+ retailers, TM-anchored) ────────────────')
    for (const p of bestPages) {
      console.log(`\n  ${p.title.slice(0, 55)} [${p.cnt} retailers]`)
      console.log(`  /product/${p.slug}`)
      console.log(`  ${(p.prices ?? '').slice(0, 110)}`)
    }
  }

  console.log('\n── ENRICHMENT COMMANDS ─────────────────────────────────────────')
  console.log('  Smart batch  : npm run enrich:wordery:smart -- --limit 200 --write')
  console.log('  Raw batch    : npm run enrich:wordery:comics -- --limit 200 --write')
  console.log('  Cohort check : dotenv -e .env.local -- tsx scripts/_tmp_cohort_analysis.ts')
  console.log('  Dashboard    : npm run dashboard')

  console.log('\n══════════════════════════════════════════════════════════════════\n')
}

main().catch(console.error).finally(() => prisma.$disconnect())
