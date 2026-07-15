/**
 * audit-edition-fragmentation.ts — READ-ONLY duplicate/fragmentation audit
 * (Wave 4 Phase 4). No writes, no merges — evidence for humans.
 *
 * Reports:
 *   1. Same-retailer duplicate listings (one product, one retailer, >1 active
 *      priced row) — the only true "duplicate row" inflation risk.
 *   2. Edition families: identical normalised titles with 2+ distinct ISBNs —
 *      NOT an error (real editions), sized so we know the presentation-
 *      grouping opportunity.
 *   3. High-confidence merge candidates: ISBN-less canonicals whose normalised
 *      title+format exactly matches an ISBN'd canonical (report-only).
 *   4. Priced listings attached to ISBN-less products (weak identity).
 *
 * Run: npm run audit:fragmentation
 * Output: launch/operations/fragmentation-audit-latest.json (+ console)
 */

import { PrismaClient } from '@prisma/client'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const prisma = new PrismaClient()
const n = (v: unknown) => Number(v ?? 0)

async function main() {
  // 1. Same-retailer duplicate listings
  const dupListings = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT l.canonical_product_id, r.name AS retailer, COUNT(*) AS rows
    FROM retailer_listings l JOIN retailers r ON r.id = l.retailer_id
    WHERE l.deleted_at IS NULL AND l.price_amount > 0 AND r.is_active
    GROUP BY l.canonical_product_id, r.name HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC LIMIT 50`

  // 2. Edition families (same normalised title, 2+ ISBNs) — sized, not listed
  const [editionFamilies] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT COUNT(*) AS families, COALESCE(SUM(members),0) AS members FROM (
      SELECT LOWER(REGEXP_REPLACE(title, '[^a-zA-Z0-9]+', ' ', 'g')) AS nt,
             COUNT(DISTINCT isbn_13) AS members
      FROM canonical_products
      WHERE deleted_at IS NULL AND isbn_13 IS NOT NULL
      GROUP BY 1 HAVING COUNT(DISTINCT isbn_13) > 1
    ) t`

  // 3. ISBN-less canonicals exactly matching an ISBN'd canonical (title+format)
  const mergeCandidates = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT a.id AS orphan_id, a.title AS orphan_title, a.format::text AS format,
           b.id AS isbn_id, b.isbn_13
    FROM canonical_products a
    JOIN canonical_products b
      ON LOWER(REGEXP_REPLACE(a.title, '[^a-zA-Z0-9]+', ' ', 'g'))
       = LOWER(REGEXP_REPLACE(b.title, '[^a-zA-Z0-9]+', ' ', 'g'))
     AND a.format = b.format
     AND b.isbn_13 IS NOT NULL AND b.deleted_at IS NULL
    WHERE a.isbn_13 IS NULL AND a.deleted_at IS NULL
    LIMIT 100`
  const [mergeCandidateCount] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT COUNT(*) AS c FROM canonical_products a
    JOIN canonical_products b
      ON LOWER(REGEXP_REPLACE(a.title, '[^a-zA-Z0-9]+', ' ', 'g'))
       = LOWER(REGEXP_REPLACE(b.title, '[^a-zA-Z0-9]+', ' ', 'g'))
     AND a.format = b.format
     AND b.isbn_13 IS NOT NULL AND b.deleted_at IS NULL
    WHERE a.isbn_13 IS NULL AND a.deleted_at IS NULL`

  // 4. Priced listings on ISBN-less products
  const [weakIdentity] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT COUNT(*) AS listings, COUNT(DISTINCT l.canonical_product_id) AS products
    FROM retailer_listings l
    JOIN canonical_products cp ON cp.id = l.canonical_product_id
    JOIN retailers r ON r.id = l.retailer_id
    WHERE l.deleted_at IS NULL AND l.price_amount > 0 AND r.is_active
      AND cp.isbn_13 IS NULL AND cp.deleted_at IS NULL`

  await prisma.$disconnect()

  const out = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'read-only Postgres queries (scripts/audit-edition-fragmentation.ts)',
    sameRetailerDuplicates: {
      groups: dupListings.length,
      sample: dupListings.slice(0, 10),
      note: 'one product + one retailer with >1 active priced row — inflates apparent coverage',
    },
    editionFamilies: {
      families: n(editionFamilies?.families),
      memberIsbns: n(editionFamilies?.members),
      note: 'same normalised title, 2+ ISBNs — REAL editions; presentation-grouping opportunity, never auto-merge',
    },
    mergeCandidates: {
      count: n(mergeCandidateCount?.c),
      sample: mergeCandidates.slice(0, 10),
      note: 'ISBN-less canonical matching an ISBN-bearing one on title+format. Report-only; any merge needs human review + editionMatchVerdict',
    },
    weakIdentityPricedListings: {
      listings: n(weakIdentity?.listings),
      products: n(weakIdentity?.products),
      note: 'priced listings on products with no ISBN — cannot participate in ISBN-keyed comparison',
    },
  }

  const dir = join(process.cwd(), 'launch', 'operations')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'fragmentation-audit-latest.json'),
    JSON.stringify(out, (_, v) => (typeof v === 'bigint' ? Number(v) : v), 2))

  console.log(`\nFRAGMENTATION AUDIT — ${out.generatedAt}`)
  console.log(`  Same-retailer duplicate groups : ${out.sameRetailerDuplicates.groups}${dupListings.length >= 50 ? ' (capped list)' : ''}`)
  console.log(`  Edition families (2+ ISBNs)    : ${out.editionFamilies.families} families / ${out.editionFamilies.memberIsbns} ISBNs`)
  console.log(`  ISBN-less merge candidates     : ${out.mergeCandidates.count} (report-only)`)
  console.log(`  Priced listings w/ weak identity: ${out.weakIdentityPricedListings.listings} on ${out.weakIdentityPricedListings.products} products`)
  console.log(`  → launch/operations/fragmentation-audit-latest.json`)
}

main().catch(e => { console.error(e); process.exit(1) })
