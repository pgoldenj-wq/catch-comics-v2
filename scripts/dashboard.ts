#!/usr/bin/env tsx
/**
 * Catch Comics — Operating Dashboard
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
  console.log(' CATCH COMICS — OPERATING DASHBOARD')
  console.log(` ${now.toISOString()}`)
  console.log('══════════════════════════════════════════════════════════════════\n')

  const [
    tmAny, tmWordery, tmBookshop, tmWob,
    threeRetailer, fourRetailer,
    worderyTotal, worderyPriced, worderyUnpricedTmLinked,
    bookshopTotal, bookshopPriced,
    wobVisible,
    prefixHitRates,
    bestPages,
    recentlyAdded,
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

    // ── Per-prefix hit rates (top 20 by attempt volume) ───────────────────────
    prisma.$queryRaw<Array<{prefix:string;total:number;priced:number;hit_rate:number}>>`
      SELECT LEFT(rl.isbn_13, 7) AS prefix,
        COUNT(*)::int AS total,
        COUNT(CASE WHEN rl.price_amount > 0 THEN 1 END)::int AS priced,
        ROUND(COUNT(CASE WHEN rl.price_amount > 0 THEN 1 END)::numeric / NULLIF(COUNT(*),0)*100,1) AS hit_rate
      FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id
      WHERE r.domain='wordery.com' AND rl.deleted_at IS NULL AND rl.isbn_13 IS NOT NULL
      GROUP BY LEFT(rl.isbn_13,7) HAVING COUNT(*)>=5
      ORDER BY COUNT(*) DESC LIMIT 20`,

    // ── Best live pages ───────────────────────────────────────────────────────
    prisma.$queryRaw<Array<{title:string;slug:string;cnt:number;retailers:string;prices:string}>>`
      SELECT cp.title, cp.canonical_slug AS slug,
        COUNT(DISTINCT rl.retailer_id)::int AS cnt,
        STRING_AGG(DISTINCT r.domain, ' | ' ORDER BY r.domain) AS retailers,
        STRING_AGG(r.domain||':£'||rl.price_amount::text, ' | ' ORDER BY rl.price_amount ASC) AS prices
      FROM canonical_products cp
      JOIN retailer_listings rl ON rl.canonical_product_id=cp.id
      JOIN retailers r ON r.id=rl.retailer_id
      WHERE cp.deleted_at IS NULL AND rl.deleted_at IS NULL AND rl.price_amount>0
        AND EXISTS (SELECT 1 FROM retailer_listings t JOIN retailers tr ON tr.id=t.retailer_id
                    WHERE tr.domain='travellingman.com' AND t.canonical_product_id=cp.id AND t.price_amount>0 AND t.deleted_at IS NULL)
      GROUP BY cp.id, cp.title, cp.canonical_slug
      HAVING COUNT(DISTINCT rl.retailer_id)>=3
      ORDER BY cnt DESC, cp.title ASC LIMIT 8`,

    // ── Recently gained pages (last 24h) ─────────────────────────────────────
    prisma.$queryRaw<[{cnt:number}]>`
      SELECT COUNT(DISTINCT rl.canonical_product_id)::int AS cnt
      FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id
      WHERE r.domain='wordery.com' AND rl.price_amount>0 AND rl.deleted_at IS NULL
        AND rl.last_seen_at >= NOW() - INTERVAL '24 hours'
        AND EXISTS (SELECT 1 FROM retailer_listings tm JOIN retailers tmr ON tmr.id=tm.retailer_id
                    WHERE tmr.domain='travellingman.com' AND tm.canonical_product_id=rl.canonical_product_id
                    AND tm.deleted_at IS NULL AND tm.price_amount>0)`,
  ])

  // ── Print ─────────────────────────────────────────────────────────────────
  console.log('── REAL COMIC COMPARISON PAGES (TM-anchored) ──────────────────')
  console.log(`  TM + any 1 other           : ${tmAny[0].cnt.toLocaleString().padStart(5)}  ← THE NUMBER`)
  console.log(`  TM + Wordery               : ${tmWordery[0].cnt.toLocaleString().padStart(5)}`)
  console.log(`  TM + Bookshop UK           : ${tmBookshop[0].cnt.toLocaleString().padStart(5)}`)
  console.log(`  TM + WoB                   : ${tmWob[0].cnt.toLocaleString().padStart(5)}`)
  console.log(`  3+ retailers               : ${threeRetailer[0].cnt.toLocaleString().padStart(5)}`)
  console.log(`  4+ retailers               : ${fourRetailer[0].cnt.toLocaleString().padStart(5)}`)

  const pagesGained = recentlyAdded[0].cnt
  console.log(`\n  Pages gained (last 24h)    : +${pagesGained}`)

  console.log('\n── WORDERY PIPELINE ───────────────────────────────────────────')
  const worderyPct = Math.round(worderyPriced / worderyTotal * 100)
  const tmLinked = worderyUnpricedTmLinked[0].cnt
  const batchesLeft = Math.ceil(tmLinked / 200)
  console.log(`  Total stubs                : ${worderyTotal.toLocaleString()}`)
  console.log(`  Priced                     : ${worderyPriced.toLocaleString()}  (${worderyPct}%)`)
  console.log(`  TM-linked & unpriced       : ${tmLinked.toLocaleString()}  ← queue`)
  console.log(`  Batches remaining (200/ea) : ~${batchesLeft}`)
  console.log(`  Est. new pages @ 50% rate  : ~${Math.round(tmLinked * 0.5).toLocaleString()}`)

  console.log('\n── BOOKSHOP UK PIPELINE ───────────────────────────────────────')
  const bkPct = Math.round(bookshopPriced / bookshopTotal * 100)
  console.log(`  Total stubs                : ${bookshopTotal.toLocaleString()}`)
  console.log(`  Priced                     : ${bookshopPriced.toLocaleString()}  (${bkPct}%)`)

  console.log('\n── WORLD OF BOOKS ─────────────────────────────────────────────')
  console.log(`  Visible (priced+matched)   : ${wobVisible.toLocaleString()}`)
  console.log(`  TM overlap                 : 0  (catalog mismatch — structural)`)

  console.log('\n── WORDERY PREFIX HIT RATES (empirical, top by volume) ────────')
  console.log(`  ${'Prefix'.padEnd(9)} ${'Stubs'.padStart(5)} ${'Priced'.padStart(6)} ${'Hit%'.padStart(5)}`)
  for (const p of prefixHitRates) {
    const bar = (p.hit_rate ?? 0) >= 60 ? '●●●' : (p.hit_rate ?? 0) >= 30 ? '●●○' : (p.hit_rate ?? 0) >= 10 ? '●○○' : '○○○'
    console.log(`  ${p.prefix.padEnd(9)} ${String(p.total).padStart(5)} ${String(p.priced).padStart(6)} ${String(p.hit_rate ?? 0).padStart(4)}% ${bar}`)
  }

  if (bestPages.length > 0) {
    console.log('\n── BEST LIVE PAGES (3+ retailers, TM-anchored) ────────────────')
    for (const p of bestPages) {
      console.log(`\n  ${p.title.slice(0, 55)} [${p.cnt}]`)
      console.log(`  /product/${p.slug}`)
      console.log(`  ${(p.prices ?? '').slice(0, 110)}`)
    }
  }

  console.log('\n══════════════════════════════════════════════════════════════════\n')
}

main().catch(console.error).finally(() => prisma.$disconnect())
