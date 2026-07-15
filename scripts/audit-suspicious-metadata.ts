/**
 * audit-suspicious-metadata.ts — READ-ONLY publisher/metadata trust audit
 * (Wave 4 Phase 6). No writes. Surfaces evidence for presentation-layer or
 * targeted reversible fixes; never mass-rewrites canonical data.
 *
 * Reports:
 *   1. Regional distributors sitting in the publisher field (the "Absolute
 *      Flash Vol 1 → PENGUIN RANDOM HOUSE NZ" class — a distributor, not the
 *      creative publisher DC).
 *   2. Retailer names in publisher fields.
 *   3. Blank publishers on otherwise-priced comic products.
 *   4. Same ISBN, inconsistent publisher across canonicals.
 *   5. Missing creators on CV-matched products (enriched but no creators).
 *   6. cv_match_suspect flagged rows.
 *
 * Run: npm run audit:metadata
 * Output: launch/operations/metadata-audit-latest.json (+ console)
 */

import { PrismaClient } from '@prisma/client'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const prisma = new PrismaClient()
const num = (v: unknown) => Number(v ?? 0)
const j = (x: unknown) => JSON.stringify(x, (_, v) => (typeof v === 'bigint' ? Number(v) : v))

// Regional distributors and wholesalers that are NOT the creative publisher.
// Presented in publisher fields they mislead collectors about who made the book.
const DISTRIBUTOR_PATTERNS = [
  'penguin random house nz', 'penguin random house australia', 'random house australia',
  'melia publishing', 'turnaround', 'gardners', 'bertrams', 'ingram', 'baker & taylor',
  'grantham book services', 'macmillan distribution', 'hachette australia',
]
const RETAILER_PATTERNS = ['amazon', 'world of books', 'waterstones', 'wordery', 'ebay', 'abebooks']

async function main() {
  // 1. Distributor-as-publisher
  const distributorRows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT publisher, COUNT(*) n FROM canonical_products
    WHERE deleted_at IS NULL AND publisher IS NOT NULL
      AND LOWER(publisher) LIKE ANY(${DISTRIBUTOR_PATTERNS.map(p => `%${p}%`)})
    GROUP BY publisher ORDER BY COUNT(*) DESC`

  // 2. Retailer-as-publisher
  const retailerRows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT publisher, COUNT(*) n FROM canonical_products
    WHERE deleted_at IS NULL AND publisher IS NOT NULL
      AND LOWER(publisher) LIKE ANY(${RETAILER_PATTERNS.map(p => `%${p}%`)})
    GROUP BY publisher ORDER BY COUNT(*) DESC`

  // 3. Blank publisher on priced comic products
  const [blankPub] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT COUNT(DISTINCT cp.id) n FROM canonical_products cp
    JOIN retailer_listings l ON l.canonical_product_id = cp.id
    JOIN retailers r ON r.id = l.retailer_id
    WHERE cp.deleted_at IS NULL AND l.deleted_at IS NULL AND l.price_amount > 0 AND r.is_active
      AND (cp.publisher IS NULL OR TRIM(cp.publisher) = '')`

  // 4. Same ISBN, inconsistent publisher
  const [inconsistent] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT COUNT(*) n FROM (
      SELECT isbn_13 FROM canonical_products
      WHERE deleted_at IS NULL AND isbn_13 IS NOT NULL AND publisher IS NOT NULL
      GROUP BY isbn_13 HAVING COUNT(DISTINCT publisher) > 1) t`

  // 5. CV-matched but no creators
  const [noCreators] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT COUNT(*) n FROM canonical_products
    WHERE deleted_at IS NULL AND comicvine_id IS NOT NULL
      AND (cv_metadata IS NULL OR NOT (cv_metadata ? 'creators')
           OR jsonb_array_length(cv_metadata->'creators') = 0)`

  // 6. cv_match_suspect flagged
  const [suspect] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT COUNT(*) n FROM canonical_products
    WHERE deleted_at IS NULL AND cv_metadata ? 'cv_match_suspect'
      AND cv_metadata->>'cv_match_suspect' NOT IN ('false', 'null')`

  await prisma.$disconnect()

  const distributorTotal = distributorRows.reduce((s, r) => s + num(r.n), 0)
  const retailerTotal     = retailerRows.reduce((s, r) => s + num(r.n), 0)

  const out = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'read-only Postgres queries (scripts/audit-suspicious-metadata.ts)',
    distributorAsPublisher: { total: distributorTotal, values: distributorRows.map(r => ({ publisher: r.publisher, n: num(r.n) })) },
    retailerAsPublisher:     { total: retailerTotal, values: retailerRows.map(r => ({ publisher: r.publisher, n: num(r.n) })) },
    blankPublisherPriced:    num(blankPub?.n),
    sameIsbnInconsistentPublisher: num(inconsistent?.n),
    cvMatchedNoCreators:     num(noCreators?.n),
    cvMatchSuspect:          num(suspect?.n),
  }

  mkdirSync(join(process.cwd(), 'launch', 'operations'), { recursive: true })
  writeFileSync(join(process.cwd(), 'launch', 'operations', 'metadata-audit-latest.json'), j(out))

  console.log(`\nSUSPICIOUS METADATA AUDIT — ${out.generatedAt}`)
  console.log(`  Distributor-as-publisher : ${out.distributorAsPublisher.total} products across ${distributorRows.length} distributor names`)
  distributorRows.slice(0, 6).forEach(r => console.log(`      "${r.publisher}" × ${num(r.n)}`))
  console.log(`  Retailer-as-publisher    : ${out.retailerAsPublisher.total}`)
  console.log(`  Blank publisher (priced) : ${out.blankPublisherPriced}`)
  console.log(`  Same ISBN, split publisher: ${out.sameIsbnInconsistentPublisher}`)
  console.log(`  CV-matched, no creators  : ${out.cvMatchedNoCreators}`)
  console.log(`  cv_match_suspect flagged : ${out.cvMatchSuspect}`)
  console.log(`  → launch/operations/metadata-audit-latest.json`)
}

main().catch(e => { console.error(e); process.exit(1) })
