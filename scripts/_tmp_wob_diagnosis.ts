/**
 * LANE 2 + 3: WoB match gap diagnosis + dry-run rematcher
 * READ ONLY — no writes.
 */
import { prisma } from '../lib/prisma'

function normaliseIsbn13(raw: string): string | null {
  if (!raw) return null
  const digits = raw.replace(/[^0-9X]/gi, '')
  // ISBN-13 as-is
  if (/^97[89]\d{10}$/.test(digits)) return digits
  // ISBN-10 → ISBN-13 conversion
  if (/^\d{9}[\dX]$/i.test(digits)) {
    const core = digits.slice(0, 9)
    const body = '978' + core
    const weights = [1,3,1,3,1,3,1,3,1,3,1,3]
    const sum = body.split('').reduce((acc, d, i) => acc + parseInt(d) * weights[i], 0)
    const check = (10 - (sum % 10)) % 10
    return body + check
  }
  return null
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' LANE 2: WoB Match Gap Diagnosis')
  console.log('══════════════════════════════════════════════════════════\n')

  // ── 1. WoB listing field snapshot ────────────────────────────────────────
  const wobSample = await prisma.$queryRaw<Array<{
    id: string; title: string; retailer_sku: string;
    price_amount: string; isbn13: string | null; ean: string | null;
    match_method: string; canonical_product_id: string | null;
    raw_isbn: string | null;
  }>>`
    SELECT
      rl.id, rl.title, rl.retailer_sku,
      rl.price_amount::text,
      rl.isbn_13    AS isbn13,
      rl.ean,
      rl.match_method::text,
      rl.canonical_product_id,
      (rl.raw_data->>'isbn')::text           AS raw_isbn
    FROM retailer_listings rl
    JOIN retailers r ON r.id = rl.retailer_id
    WHERE r.domain = 'worldofbooks.com'
      AND rl.price_amount > 0
      AND rl.deleted_at IS NULL
    ORDER BY RANDOM()
    LIMIT 50
  `

  const hasIsbn13    = wobSample.filter(r => r.isbn13).length
  const hasEan       = wobSample.filter(r => r.ean).length
  const hasRawIsbn   = wobSample.filter(r => r.raw_isbn).length
  const isUnmatched  = wobSample.filter(r => !r.canonical_product_id).length

  console.log('── WoB Sample (50 priced listings) ─────────────────────')
  console.log(`  Has isbn_13 column  : ${hasIsbn13}/50`)
  console.log(`  Has ean column      : ${hasEan}/50`)
  console.log(`  Has raw_data.isbn   : ${hasRawIsbn}/50`)
  console.log(`  Unmatched           : ${isUnmatched}/50`)

  console.log('\n── First 10 raw rows ─────────────────────────────────────')
  for (const r of wobSample.slice(0, 10)) {
    console.log(`  SKU: ${r.retailer_sku.padEnd(16)} | isbn13: ${(r.isbn13 ?? '—').padEnd(14)} | ean: ${(r.ean ?? '—').padEnd(14)} | raw_isbn: ${(r.raw_isbn ?? '—').padEnd(14)} | matched: ${r.canonical_product_id ? 'YES' : 'NO'} | ${r.title.slice(0,40)}`)
  }

  // ── 2. Check WoB listings with isbn_13 that DON'T match canonicals ───────
  console.log('\n── WoB: priced + has isbn_13 but UNMATCHED ─────────────')
  const wobPricedWithIsbn = await prisma.$queryRaw<[{ cnt: number }]>`
    SELECT COUNT(*)::int AS cnt
    FROM retailer_listings rl
    JOIN retailers r ON r.id = rl.retailer_id
    WHERE r.domain = 'worldofbooks.com'
      AND rl.price_amount > 0
      AND rl.isbn_13 IS NOT NULL
      AND rl.canonical_product_id IS NULL
      AND rl.deleted_at IS NULL
  `
  const wobPricedNoIsbn = await prisma.$queryRaw<[{ cnt: number }]>`
    SELECT COUNT(*)::int AS cnt
    FROM retailer_listings rl
    JOIN retailers r ON r.id = rl.retailer_id
    WHERE r.domain = 'worldofbooks.com'
      AND rl.price_amount > 0
      AND rl.isbn_13 IS NULL
      AND rl.canonical_product_id IS NULL
      AND rl.deleted_at IS NULL
  `
  console.log(`  Priced + has isbn_13 + unmatched : ${wobPricedWithIsbn[0].cnt.toLocaleString()}`)
  console.log(`  Priced + NO isbn_13 + unmatched  : ${wobPricedNoIsbn[0].cnt.toLocaleString()}`)

  // ── 3. ISBN overlap: WoB isbn_13 vs canonical isbn_13 ────────────────────
  console.log('\n── Direct ISBN overlap: WoB ∩ Canonical ─────────────────')
  const directIsbnOverlap = await prisma.$queryRaw<[{ cnt: number }]>`
    SELECT COUNT(*)::int AS cnt
    FROM retailer_listings rl
    JOIN retailers r ON r.id = rl.retailer_id
    JOIN canonical_products cp ON cp.isbn_13 = rl.isbn_13
    WHERE r.domain = 'worldofbooks.com'
      AND rl.price_amount > 0
      AND rl.isbn_13 IS NOT NULL
      AND rl.deleted_at IS NULL
      AND cp.deleted_at IS NULL
  `
  console.log(`  WoB priced ISBNs directly in canonical_products: ${directIsbnOverlap[0].cnt.toLocaleString()}`)
  console.log(`  → These COULD be matched but currently aren't (canonical_product_id = NULL)`)

  // ── 4. Sample of matchable WoB listings ──────────────────────────────────
  const matchableSample = await prisma.$queryRaw<Array<{
    wob_id: string; wob_title: string; isbn13: string;
    wob_price: string; canonical_title: string; canonical_slug: string;
  }>>`
    SELECT
      rl.id AS wob_id,
      rl.title AS wob_title,
      rl.isbn_13 AS isbn13,
      rl.price_amount::text AS wob_price,
      cp.title AS canonical_title,
      cp.canonical_slug
    FROM retailer_listings rl
    JOIN retailers r ON r.id = rl.retailer_id
    JOIN canonical_products cp ON cp.isbn_13 = rl.isbn_13
    WHERE r.domain = 'worldofbooks.com'
      AND rl.price_amount > 0
      AND rl.isbn_13 IS NOT NULL
      AND rl.canonical_product_id IS NULL
      AND rl.deleted_at IS NULL
      AND cp.deleted_at IS NULL
    LIMIT 20
  `
  console.log(`\n── Sample: matchable WoB → canonical (first 20) ─────────`)
  for (const m of matchableSample) {
    console.log(`  WoB: "${m.wob_title.slice(0,35)}" £${m.wob_price}`)
    console.log(`  → Canonical: "${m.canonical_title.slice(0,40)}"`)
    console.log(`  → URL: /product/${m.canonical_slug}`)
    console.log()
  }

  // ── 5. Of those matchable, how many already have TM as a retailer? ────────
  const tmWobPotentialOverlap = await prisma.$queryRaw<[{ cnt: number }]>`
    SELECT COUNT(DISTINCT cp.id)::int AS cnt
    FROM retailer_listings wob_rl
    JOIN retailers wob_r ON wob_r.id = wob_rl.retailer_id
    JOIN canonical_products cp ON cp.isbn_13 = wob_rl.isbn_13
    JOIN retailer_listings tm_rl ON tm_rl.canonical_product_id = cp.id
    JOIN retailers tm_r ON tm_r.id = tm_rl.retailer_id
    WHERE wob_r.domain = 'worldofbooks.com'
      AND tm_r.domain = 'travellingman.com'
      AND wob_rl.price_amount > 0
      AND tm_rl.price_amount > 0
      AND wob_rl.isbn_13 IS NOT NULL
      AND wob_rl.canonical_product_id IS NULL
      AND wob_rl.deleted_at IS NULL
      AND tm_rl.deleted_at IS NULL
      AND cp.deleted_at IS NULL
  `
  console.log(`── LANE 3: WoB Rematch Opportunity ──────────────────────`)
  console.log(`  WoB listings matchable by ISBN → canonical: ${directIsbnOverlap[0].cnt.toLocaleString()}`)
  console.log(`  Of those, canonical also has TM pricing   : ${tmWobPotentialOverlap[0].cnt.toLocaleString()}`)
  console.log(`  → Fixing these would add ${tmWobPotentialOverlap[0].cnt.toLocaleString()} TM+WoB comparison pages`)

  // ── 6. LANE 4: Non-comic canonical detection ───────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' LANE 4: Non-Comic Canonical Detection')
  console.log('══════════════════════════════════════════════════════════\n')

  // Find canonicals that have multi-retailer pricing but no TM listing
  // (these are the suspicious non-comics inflating the 704 count)
  const nonComicMultiRetailer = await prisma.$queryRaw<Array<{
    title: string; slug: string; isbn13: string; format: string;
    retailer_count: number; retailers: string;
  }>>`
    SELECT
      cp.title, cp.canonical_slug AS slug, cp.isbn_13 AS isbn13,
      cp.format::text,
      COUNT(DISTINCT rl.retailer_id)::int AS retailer_count,
      STRING_AGG(DISTINCT r.domain, ', ') AS retailers
    FROM canonical_products cp
    JOIN retailer_listings rl ON rl.canonical_product_id = cp.id
    JOIN retailers r ON r.id = rl.retailer_id
    WHERE cp.deleted_at IS NULL
      AND rl.deleted_at IS NULL
      AND rl.price_amount > 0
      AND NOT EXISTS (
        SELECT 1 FROM retailer_listings tm
        JOIN retailers tmr ON tmr.id = tm.retailer_id
        WHERE tmr.domain = 'travellingman.com'
          AND tm.canonical_product_id = cp.id
          AND tm.deleted_at IS NULL
      )
    GROUP BY cp.id, cp.title, cp.canonical_slug, cp.isbn_13, cp.format
    HAVING COUNT(DISTINCT rl.retailer_id) >= 2
    ORDER BY COUNT(DISTINCT rl.retailer_id) DESC, cp.title ASC
    LIMIT 30
  `

  console.log('── Multi-retailer canonicals with NO Travelling Man ─────')
  console.log('   (these are the likely non-comics inflating the count)\n')
  let nonComicCount = 0
  for (const nc of nonComicMultiRetailer) {
    const likelyComic = nc.title.toLowerCase().match(/volume|vol\.|manga|graphic|comic|omnibus|collection/)
    if (!likelyComic) nonComicCount++
    const flag = likelyComic ? '  ?' : '✗ NOT COMIC'
    console.log(`  ${flag}  "${nc.title.slice(0,55)}"`)
    console.log(`         format=${nc.format} | ${nc.retailers} | ${nc.retailer_count} retailers`)
  }
  console.log(`\n  Obvious non-comics in this sample: ~${nonComicCount}`)

  // Count total non-TM multi-retailer pages (the inflated count)
  const nonTmMultiTotal = await prisma.$queryRaw<[{ cnt: number }]>`
    SELECT COUNT(*)::int AS cnt FROM (
      SELECT cp.id
      FROM canonical_products cp
      JOIN retailer_listings rl ON rl.canonical_product_id = cp.id
      WHERE cp.deleted_at IS NULL AND rl.deleted_at IS NULL AND rl.price_amount > 0
      GROUP BY cp.id
      HAVING COUNT(DISTINCT rl.retailer_id) >= 2
        AND COUNT(DISTINCT CASE WHEN (
          SELECT domain FROM retailers WHERE id = rl.retailer_id
        ) = 'travellingman.com' THEN rl.retailer_id END) = 0
    ) s
  `
  const tmMultiTotal = await prisma.$queryRaw<[{ cnt: number }]>`
    SELECT COUNT(*)::int AS cnt FROM (
      SELECT cp.id
      FROM canonical_products cp
      JOIN retailer_listings rl ON rl.canonical_product_id = cp.id
      JOIN retailers r ON r.id = rl.retailer_id
      WHERE cp.deleted_at IS NULL AND rl.deleted_at IS NULL AND rl.price_amount > 0
      GROUP BY cp.id
      HAVING COUNT(DISTINCT rl.retailer_id) >= 2
        AND COUNT(DISTINCT CASE WHEN r.domain = 'travellingman.com' THEN 1 END) > 0
    ) s
  `

  console.log(`\n── Multi-retailer breakdown ──────────────────────────────`)
  console.log(`  Include TM (real comic comparisons) : ${tmMultiTotal[0].cnt.toLocaleString()}`)
  console.log(`  No TM (WoB+Wordery non-comics)      : ${nonTmMultiTotal[0].cnt.toLocaleString()}`)
  console.log(`  Total reported "2+ retailer"         : ${(tmMultiTotal[0].cnt + nonTmMultiTotal[0].cnt).toLocaleString()}`)

  console.log('\n══════════════════════════════════════════════════════════\n')
}

main().catch(console.error).finally(() => prisma.$disconnect())
