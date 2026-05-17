/**
 * Retailer Health Dashboard + Bottleneck Diagnostics
 */
import { prisma } from '../lib/prisma'

async function main() {
  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' CATCH COMICS — RETAILER HEALTH DASHBOARD')
  console.log('══════════════════════════════════════════════════════════\n')

  // ── 1. Core counts ────────────────────────────────────────────────────────
  const [
    totalCanonical,
    totalWithIsbn,
    perRetailer,
    multiRetailer2,
    multiRetailer3,
    unmatchedListings,
  ] = await Promise.all([
    prisma.canonicalProduct.count({ where: { deletedAt: null } }),
    prisma.canonicalProduct.count({ where: { deletedAt: null, isbn13: { not: null } } }),
    prisma.$queryRaw<Array<{
      domain: string; platform: string;
      total: number; priced: number; matched: number; visible: number;
    }>>`
      SELECT
        r.domain, r.platform,
        COUNT(rl.id)::int                                                          AS total,
        COUNT(CASE WHEN rl.price_amount > 0 THEN 1 END)::int                      AS priced,
        COUNT(CASE WHEN rl.canonical_product_id IS NOT NULL THEN 1 END)::int      AS matched,
        COUNT(CASE WHEN rl.price_amount > 0 AND rl.canonical_product_id IS NOT NULL THEN 1 END)::int AS visible
      FROM retailers r
      LEFT JOIN retailer_listings rl ON rl.retailer_id = r.id AND rl.deleted_at IS NULL
      GROUP BY r.id, r.domain, r.platform
      ORDER BY visible DESC
    `,
    prisma.$queryRaw<[{ cnt: number }]>`
      SELECT COUNT(*)::int AS cnt FROM (
        SELECT canonical_product_id FROM retailer_listings
        WHERE price_amount > 0 AND canonical_product_id IS NOT NULL AND deleted_at IS NULL
        GROUP BY canonical_product_id HAVING COUNT(DISTINCT retailer_id) >= 2
      ) s
    `,
    prisma.$queryRaw<[{ cnt: number }]>`
      SELECT COUNT(*)::int AS cnt FROM (
        SELECT canonical_product_id FROM retailer_listings
        WHERE price_amount > 0 AND canonical_product_id IS NOT NULL AND deleted_at IS NULL
        GROUP BY canonical_product_id HAVING COUNT(DISTINCT retailer_id) >= 3
      ) s
    `,
    prisma.$queryRaw<[{ cnt: number }]>`
      SELECT COUNT(*)::int AS cnt FROM retailer_listings
      WHERE canonical_product_id IS NULL AND deleted_at IS NULL
    `,
  ])

  console.log('── CANONICAL PRODUCTS ───────────────────────────────────')
  console.log(`  Total canonical products : ${totalCanonical.toLocaleString()}`)
  console.log(`  With ISBN-13             : ${totalWithIsbn.toLocaleString()}`)
  console.log(`  Products with 2+ retailers priced : ${multiRetailer2[0].cnt.toLocaleString()}`)
  console.log(`  Products with 3+ retailers priced : ${multiRetailer3[0].cnt.toLocaleString()}`)
  console.log(`  Unmatched listings (no canonical) : ${unmatchedListings[0].cnt.toLocaleString()}`)

  console.log('\n── PER-RETAILER BREAKDOWN ───────────────────────────────')
  console.log(`  ${'Domain'.padEnd(22)} ${'Platform'.padEnd(14)} ${'Total'.padStart(7)} ${'Priced'.padStart(7)} ${'Matched'.padStart(8)} ${'Visible'.padStart(8)}`)
  console.log(`  ${'─'.repeat(22)} ${'─'.repeat(14)} ${'─'.repeat(7)} ${'─'.repeat(7)} ${'─'.repeat(8)} ${'─'.repeat(8)}`)
  for (const r of perRetailer) {
    console.log(`  ${r.domain.padEnd(22)} ${r.platform.padEnd(14)} ${String(r.total).padStart(7)} ${String(r.priced).padStart(7)} ${String(r.matched).padStart(8)} ${String(r.visible).padStart(8)}`)
  }

  // ── 2. Retailer overlap matrix ────────────────────────────────────────────
  const overlapMatrix = await prisma.$queryRaw<Array<{ r1: string; r2: string; overlap: number }>>`
    SELECT a.domain AS r1, b.domain AS r2, COUNT(*)::int AS overlap
    FROM retailer_listings la
    JOIN retailers a ON a.id = la.retailer_id
    JOIN retailer_listings lb ON lb.canonical_product_id = la.canonical_product_id
    JOIN retailers b ON b.id = lb.retailer_id
    WHERE la.price_amount > 0 AND lb.price_amount > 0
      AND la.canonical_product_id IS NOT NULL
      AND la.deleted_at IS NULL AND lb.deleted_at IS NULL
      AND a.domain < b.domain
    GROUP BY a.domain, b.domain
    ORDER BY overlap DESC
    LIMIT 20
  `
  console.log('\n── RETAILER OVERLAP MATRIX (priced products in common) ──')
  for (const row of overlapMatrix) {
    console.log(`  ${row.r1.padEnd(22)} ∩ ${row.r2.padEnd(22)} = ${row.overlap.toLocaleString()}`)
  }

  // ── 3. 20 real multi-retailer products ────────────────────────────────────
  const examples = await prisma.$queryRaw<Array<{
    slug: string; title: string; retailers: string; retailer_count: number; prices: string;
  }>>`
    SELECT
      cp.canonical_slug AS slug,
      cp.title,
      COUNT(DISTINCT rl.retailer_id)::int AS retailer_count,
      STRING_AGG(DISTINCT r.domain, ' | ' ORDER BY r.domain) AS retailers,
      STRING_AGG(r.domain || ':£' || rl.price_amount::text, ' | ' ORDER BY rl.price_amount ASC) AS prices
    FROM canonical_products cp
    JOIN retailer_listings rl ON rl.canonical_product_id = cp.id
    JOIN retailers r ON r.id = rl.retailer_id
    WHERE cp.deleted_at IS NULL
      AND rl.deleted_at IS NULL
      AND rl.price_amount > 0
    GROUP BY cp.id, cp.canonical_slug, cp.title
    HAVING COUNT(DISTINCT rl.retailer_id) >= 2
    ORDER BY COUNT(DISTINCT rl.retailer_id) DESC, cp.title ASC
    LIMIT 20
  `

  console.log('\n── 20 REAL MULTI-RETAILER PRODUCT PAGES ────────────────')
  for (const ex of examples) {
    console.log(`\n  ${ex.title.slice(0, 60)}`)
    console.log(`  URL     : https://catchcomics.com/product/${ex.slug}`)
    console.log(`  Retailers (${ex.retailer_count}): ${ex.retailers}`)
    console.log(`  Prices  : ${ex.prices?.slice(0, 120) ?? '—'}`)
  }

  // ── 4. Bottleneck diagnosis ───────────────────────────────────────────────
  console.log('\n── BOTTLENECK DIAGNOSIS ─────────────────────────────────')

  // 4a. Wordery stubs: matched but unpriced (stubs not yet enriched)
  const worderyUnpriced = await prisma.retailerListing.count({
    where: {
      retailer: { domain: 'wordery.com' },
      canonicalProductId: { not: null },
      priceAmount: { lte: 0 },
      deletedAt: null,
    },
  })
  const worderyPriced = await prisma.retailerListing.count({
    where: {
      retailer: { domain: 'wordery.com' },
      canonicalProductId: { not: null },
      priceAmount: { gt: 0 },
      deletedAt: null,
    },
  })
  console.log(`\n  Wordery (wordery.com):`)
  console.log(`    Matched stubs, priced   : ${worderyPriced.toLocaleString()}`)
  console.log(`    Matched stubs, UNPRICED : ${worderyUnpriced.toLocaleString()}  ← these are hidden`)

  // 4b. Bookshop stubs: matched but unpriced
  const bkUnpriced = await prisma.retailerListing.count({
    where: {
      retailer: { domain: 'uk.bookshop.org' },
      canonicalProductId: { not: null },
      priceAmount: { lte: 0 },
      deletedAt: null,
    },
  })
  const bkPriced = await prisma.retailerListing.count({
    where: {
      retailer: { domain: 'uk.bookshop.org' },
      canonicalProductId: { not: null },
      priceAmount: { gt: 0 },
      deletedAt: null,
    },
  })
  console.log(`\n  Bookshop.org UK (uk.bookshop.org):`)
  console.log(`    Matched stubs, priced   : ${bkPriced.toLocaleString()}`)
  console.log(`    Matched stubs, UNPRICED : ${bkUnpriced.toLocaleString()}  ← these are hidden`)

  // 4c. TM-linked Wordery stubs that are STILL unpriced (next batch targets)
  const tmLinkedWorderyUnpriced = await prisma.$queryRaw<[{ cnt: number }]>`
    SELECT COUNT(*)::int AS cnt
    FROM retailer_listings rl
    JOIN retailers r ON r.id = rl.retailer_id
    WHERE r.domain = 'wordery.com'
      AND rl.deleted_at IS NULL
      AND rl.price_amount <= 0
      AND rl.isbn_13 IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM retailer_listings tm_rl
        JOIN retailers tm_r ON tm_r.id = tm_rl.retailer_id
        WHERE tm_r.domain = 'travellingman.com'
          AND tm_rl.canonical_product_id = rl.canonical_product_id
          AND tm_rl.deleted_at IS NULL
          AND tm_rl.price_amount > 0
      )
  `
  console.log(`\n  TM-linked Wordery stubs still unpriced : ${tmLinkedWorderyUnpriced[0].cnt.toLocaleString()}  ← next enrichment targets`)

  // 4d. WoB - how many are unmatched to canonicals?
  const wobUnmatched = await prisma.retailerListing.count({
    where: {
      retailer: { domain: 'worldofbooks.com' },
      canonicalProductId: null,
      priceAmount: { gt: 0 },
      deletedAt: null,
    },
  })
  const wobVisible = await prisma.retailerListing.count({
    where: {
      retailer: { domain: 'worldofbooks.com' },
      canonicalProductId: { not: null },
      priceAmount: { gt: 0 },
      deletedAt: null,
    },
  })
  console.log(`\n  World of Books (worldofbooks.com):`)
  console.log(`    Priced + matched (visible) : ${wobVisible.toLocaleString()}`)
  console.log(`    Priced but UNMATCHED       : ${wobUnmatched.toLocaleString()}  ← invisible, need ISBN matching`)

  // 4e. Check if TM + Wordery now have real overlap
  const tmWorderyOverlap = await prisma.$queryRaw<[{ cnt: number }]>`
    SELECT COUNT(*)::int AS cnt FROM (
      SELECT rl.canonical_product_id
      FROM retailer_listings rl
      JOIN retailers r ON r.id = rl.retailer_id
      WHERE r.domain = 'wordery.com' AND rl.price_amount > 0
        AND rl.canonical_product_id IS NOT NULL AND rl.deleted_at IS NULL
      INTERSECT
      SELECT rl.canonical_product_id
      FROM retailer_listings rl
      JOIN retailers r ON r.id = rl.retailer_id
      WHERE r.domain = 'travellingman.com' AND rl.price_amount > 0
        AND rl.canonical_product_id IS NOT NULL AND rl.deleted_at IS NULL
    ) s
  `
  const tmBkOverlap = await prisma.$queryRaw<[{ cnt: number }]>`
    SELECT COUNT(*)::int AS cnt FROM (
      SELECT rl.canonical_product_id
      FROM retailer_listings rl JOIN retailers r ON r.id = rl.retailer_id
      WHERE r.domain = 'uk.bookshop.org' AND rl.price_amount > 0
        AND rl.canonical_product_id IS NOT NULL AND rl.deleted_at IS NULL
      INTERSECT
      SELECT rl.canonical_product_id
      FROM retailer_listings rl JOIN retailers r ON r.id = rl.retailer_id
      WHERE r.domain = 'travellingman.com' AND rl.price_amount > 0
        AND rl.canonical_product_id IS NOT NULL AND rl.deleted_at IS NULL
    ) s
  `
  const tmWobOverlap = await prisma.$queryRaw<[{ cnt: number }]>`
    SELECT COUNT(*)::int AS cnt FROM (
      SELECT rl.canonical_product_id
      FROM retailer_listings rl JOIN retailers r ON r.id = rl.retailer_id
      WHERE r.domain = 'worldofbooks.com' AND rl.price_amount > 0
        AND rl.canonical_product_id IS NOT NULL AND rl.deleted_at IS NULL
      INTERSECT
      SELECT rl.canonical_product_id
      FROM retailer_listings rl JOIN retailers r ON r.id = rl.retailer_id
      WHERE r.domain = 'travellingman.com' AND rl.price_amount > 0
        AND rl.canonical_product_id IS NOT NULL AND rl.deleted_at IS NULL
    ) s
  `

  console.log('\n── PAIRWISE OVERLAP WITH TRAVELLING MAN ─────────────────')
  console.log(`  TM ∩ Wordery      : ${tmWorderyOverlap[0].cnt.toLocaleString()} products`)
  console.log(`  TM ∩ Bookshop UK  : ${tmBkOverlap[0].cnt.toLocaleString()} products`)
  console.log(`  TM ∩ World of Books: ${tmWobOverlap[0].cnt.toLocaleString()} products`)

  console.log('\n══════════════════════════════════════════════════════════\n')
}

main().catch(console.error).finally(() => prisma.$disconnect())
