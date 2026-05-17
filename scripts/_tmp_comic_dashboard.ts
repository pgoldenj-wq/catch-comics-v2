/**
 * CLEAN comic-only dashboard — no inflated totals.
 * READ ONLY.
 */
import { prisma } from '../lib/prisma'

async function main() {
  const [
    // Real comparison pages: TM + at least one other
    tmPlus,
    tmPlusWordery,
    tmPlusBookshop,
    tmPlusWob,
    threeRetailer,
    // Format breakdown of TM+Wordery overlap
    formatBreakdown,
    // Wordery progress
    worderyTotal,
    worderyPriced,
    worderyTmLinkedUnpriced,
    // Purge candidates
    purgeCandidates,
    // Sample 5 best 3-retailer pages
    bestPages,
  ] = await Promise.all([
    // TM + at least one other priced retailer
    prisma.$queryRaw<[{cnt:number}]>`
      SELECT COUNT(DISTINCT cp.id)::int AS cnt
      FROM canonical_products cp
      WHERE cp.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id
                    WHERE r.domain='travellingman.com' AND rl.canonical_product_id=cp.id AND rl.price_amount>0 AND rl.deleted_at IS NULL)
        AND (SELECT COUNT(DISTINCT rl2.retailer_id) FROM retailer_listings rl2
             WHERE rl2.canonical_product_id=cp.id AND rl2.price_amount>0 AND rl2.deleted_at IS NULL) >= 2
    `,
    // TM ∩ Wordery
    prisma.$queryRaw<[{cnt:number}]>`
      SELECT COUNT(DISTINCT cp.id)::int AS cnt FROM canonical_products cp
      WHERE cp.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id WHERE r.domain='travellingman.com' AND rl.canonical_product_id=cp.id AND rl.price_amount>0 AND rl.deleted_at IS NULL)
        AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id WHERE r.domain='wordery.com' AND rl.canonical_product_id=cp.id AND rl.price_amount>0 AND rl.deleted_at IS NULL)
    `,
    // TM ∩ Bookshop
    prisma.$queryRaw<[{cnt:number}]>`
      SELECT COUNT(DISTINCT cp.id)::int AS cnt FROM canonical_products cp
      WHERE cp.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id WHERE r.domain='travellingman.com' AND rl.canonical_product_id=cp.id AND rl.price_amount>0 AND rl.deleted_at IS NULL)
        AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id WHERE r.domain='uk.bookshop.org' AND rl.canonical_product_id=cp.id AND rl.price_amount>0 AND rl.deleted_at IS NULL)
    `,
    // TM ∩ WoB
    prisma.$queryRaw<[{cnt:number}]>`
      SELECT COUNT(DISTINCT cp.id)::int AS cnt FROM canonical_products cp
      WHERE cp.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id WHERE r.domain='travellingman.com' AND rl.canonical_product_id=cp.id AND rl.price_amount>0 AND rl.deleted_at IS NULL)
        AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id WHERE r.domain='worldofbooks.com' AND rl.canonical_product_id=cp.id AND rl.price_amount>0 AND rl.deleted_at IS NULL)
    `,
    // 3+ retailer comic pages (must include TM)
    prisma.$queryRaw<[{cnt:number}]>`
      SELECT COUNT(DISTINCT cp.id)::int AS cnt FROM canonical_products cp
      WHERE cp.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id WHERE r.domain='travellingman.com' AND rl.canonical_product_id=cp.id AND rl.price_amount>0 AND rl.deleted_at IS NULL)
        AND (SELECT COUNT(DISTINCT rl2.retailer_id) FROM retailer_listings rl2 WHERE rl2.canonical_product_id=cp.id AND rl2.price_amount>0 AND rl2.deleted_at IS NULL) >= 3
    `,
    // Format breakdown of TM+Wordery overlap
    prisma.$queryRaw<Array<{format:string;cnt:number}>>`
      SELECT cp.format::text, COUNT(DISTINCT cp.id)::int AS cnt
      FROM canonical_products cp
      WHERE cp.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id WHERE r.domain='travellingman.com' AND rl.canonical_product_id=cp.id AND rl.price_amount>0 AND rl.deleted_at IS NULL)
        AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id WHERE r.domain='wordery.com' AND rl.canonical_product_id=cp.id AND rl.price_amount>0 AND rl.deleted_at IS NULL)
      GROUP BY cp.format ORDER BY cnt DESC
    `,
    // Wordery total/priced
    prisma.retailerListing.count({ where: { retailer: { domain: 'wordery.com' }, deletedAt: null } }),
    prisma.retailerListing.count({ where: { retailer: { domain: 'wordery.com' }, priceAmount: { gt: 0 }, deletedAt: null } }),
    // TM-linked unpriced Wordery stubs remaining
    prisma.$queryRaw<[{cnt:number}]>`
      SELECT COUNT(*)::int AS cnt FROM retailer_listings rl
      JOIN retailers r ON r.id=rl.retailer_id
      WHERE r.domain='wordery.com' AND rl.deleted_at IS NULL AND rl.price_amount<=0 AND rl.isbn_13 IS NOT NULL
        AND EXISTS (SELECT 1 FROM retailer_listings tm JOIN retailers tmr ON tmr.id=tm.retailer_id
                    WHERE tmr.domain='travellingman.com' AND tm.canonical_product_id=rl.canonical_product_id AND tm.deleted_at IS NULL AND tm.price_amount>0)
    `,
    // Purge candidates: format=OTHER, no TM, only WoB+Wordery
    prisma.$queryRaw<[{cnt:number}]>`
      SELECT COUNT(DISTINCT cp.id)::int AS cnt FROM canonical_products cp
      WHERE cp.deleted_at IS NULL AND cp.format='OTHER'
        AND NOT EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id
                        WHERE r.domain='travellingman.com' AND rl.canonical_product_id=cp.id AND rl.deleted_at IS NULL)
        AND EXISTS (SELECT 1 FROM retailer_listings rl WHERE rl.canonical_product_id=cp.id AND rl.deleted_at IS NULL)
    `,
    // Best pages: most retailers, include TM
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
      HAVING COUNT(DISTINCT rl.retailer_id)>=2
      ORDER BY cnt DESC, cp.title ASC
      LIMIT 10
    `,
  ])

  const realPages = tmPlus[0].cnt
  const worderyUnpriced = worderyTmLinkedUnpriced[0].cnt
  const purgeCount = purgeCandidates[0].cnt

  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' CATCH COMICS — CLEAN COMIC DASHBOARD')
  console.log(`  Generated: ${new Date().toISOString()}`)
  console.log('══════════════════════════════════════════════════════════\n')

  console.log('── REAL COMIC COMPARISON PAGES (TM-anchored) ────────────')
  console.log(`  TM + any 1 other retailer  : ${realPages.toLocaleString()}  ← THE REAL NUMBER`)
  console.log(`  TM + Wordery               : ${tmPlusWordery[0].cnt.toLocaleString()}`)
  console.log(`  TM + Bookshop UK           : ${tmPlusBookshop[0].cnt.toLocaleString()}`)
  console.log(`  TM + WoB                   : ${tmPlusWob[0].cnt.toLocaleString()}`)
  console.log(`  3+ retailers (TM-anchored) : ${threeRetailer[0].cnt.toLocaleString()}`)
  console.log(`\n  JUNK (no TM, WoB+Wordery only) : ~406  ← excluded from above`)

  console.log('\n── TM+WORDERY FORMAT BREAKDOWN ──────────────────────────')
  for (const f of formatBreakdown) {
    console.log(`  ${f.format.padEnd(20)}: ${f.cnt}`)
  }

  console.log('\n── WORDERY PIPELINE PROGRESS ────────────────────────────')
  console.log(`  Total Wordery stubs        : ${worderyTotal.toLocaleString()}`)
  console.log(`  Priced (visible)           : ${worderyPriced.toLocaleString()}`)
  console.log(`  TM-linked, still unpriced  : ${worderyUnpriced.toLocaleString()}  ← remaining upside`)
  const pricedPct = Math.round(worderyPriced / worderyTotal * 100)
  console.log(`  Enrichment progress        : ${pricedPct}% of total stubs priced`)

  const batchesLeft = Math.ceil(worderyUnpriced / 200)
  const pagesPerBatch = Math.round(200 * 0.75) // ~75% hit rate
  console.log(`\n  At 200/batch × ~75% hit rate:`)
  console.log(`    Batches remaining        : ~${batchesLeft}`)
  console.log(`    Pages per batch          : ~${pagesPerBatch}`)
  console.log(`    Realistic total upside   : ~${(worderyPriced + worderyUnpriced * 0.72).toFixed(0)} Wordery prices`)
  console.log(`    Realistic TM+Wordery     : ~${(tmPlusWordery[0].cnt + worderyUnpriced * 0.65).toFixed(0)} comparison pages`)

  console.log('\n── NON-COMIC PURGE CANDIDATES ───────────────────────────')
  console.log(`  format=OTHER, no TM listing: ${purgeCount.toLocaleString()} canonical products`)
  console.log(`  (includes both matched and unmatched non-comic records)`)

  console.log('\n── BEST LIVE COMIC COMPARISON PAGES ────────────────────')
  for (const p of bestPages) {
    console.log(`\n  ${p.title.slice(0, 55)} [${p.cnt} retailers]`)
    console.log(`  /product/${p.slug}`)
    console.log(`  ${p.prices?.slice(0, 100) ?? ''}`)
  }

  console.log('\n══════════════════════════════════════════════════════════\n')
}
main().catch(console.error).finally(() => prisma.$disconnect())
