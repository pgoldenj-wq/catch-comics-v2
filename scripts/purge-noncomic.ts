#!/usr/bin/env tsx
/**
 * Non-comic canonical purge.
 *
 * Soft-deletes canonical_products that are definitively NOT comics:
 *   1. format = 'OTHER'
 *   2. No Travelling Man listing (any status)
 *   3. ALL retailer listings come from WoB and/or Wordery only
 *   4. Title contains NO comic/manga/GN keywords
 *   5. deleted_at IS NULL (not already purged)
 *
 * Safe by design:
 *   - TM listing = immediate exclusion
 *   - Keyword match = immediate exclusion
 *   - Only soft-deletes (sets deleted_at, never hard-deletes)
 *   - Default: DRY-RUN. Pass --write to execute.
 *
 * Usage:
 *   npx tsx scripts/purge-noncomic.ts              ← dry-run
 *   npx tsx scripts/purge-noncomic.ts --write      ← execute purge
 */
import { prisma } from '../lib/prisma'

const WRITE = process.argv.includes('--write')
const DRY   = !WRITE

const COMIC_KEYWORDS = /volume|vol\b|manga|graphic novel|omnibus|collection|tpb|trade paper|issue|comic|superhero|batman|spider|marvel|dc comics|image comics|dark horse|idw|boom|fantagraphics|drawn & quarterly|vertigo|titan comics|valiant|indie comic/i

async function main() {
  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' Non-Comic Canonical Purge')
  console.log(` Mode: ${DRY ? 'DRY-RUN (pass --write to execute)' : 'WRITE — EXECUTING PURGE'}`)
  console.log('══════════════════════════════════════════════════════════\n')

  // Find all candidates matching the purge criteria
  const candidates = await prisma.$queryRaw<Array<{
    id: string
    title: string
    isbn13: string | null
    format: string
    retailers: string
    listing_count: number
  }>>`
    SELECT
      cp.id,
      cp.title,
      cp.isbn_13     AS isbn13,
      cp.format::text,
      STRING_AGG(DISTINCT r.domain, ', ') AS retailers,
      COUNT(rl.id)::int AS listing_count
    FROM canonical_products cp
    JOIN retailer_listings rl ON rl.canonical_product_id = cp.id
    JOIN retailers r ON r.id = rl.retailer_id
    WHERE cp.deleted_at IS NULL
      AND cp.format = 'OTHER'
      -- Must have NO Travelling Man listing at all
      AND NOT EXISTS (
        SELECT 1
        FROM retailer_listings t
        JOIN retailers tr ON tr.id = t.retailer_id
        WHERE tr.domain = 'travellingman.com'
          AND t.canonical_product_id = cp.id
          AND t.deleted_at IS NULL
      )
    GROUP BY cp.id, cp.title, cp.isbn_13, cp.format
    -- ALL listings must come only from WoB and/or Wordery
    HAVING bool_and(r.domain IN ('worldofbooks.com', 'wordery.com'))
    ORDER BY cp.title ASC
  `

  console.log(`Total candidates matching format+retailer criteria: ${candidates.length.toLocaleString()}`)

  // Split: high-confidence (no keywords) vs. needs-review (has keywords)
  const safe    = candidates.filter(c => !COMIC_KEYWORDS.test(c.title))
  const review  = candidates.filter(c =>  COMIC_KEYWORDS.test(c.title))

  console.log(`  High-confidence non-comic (NO keywords) : ${safe.length.toLocaleString()}  ← will purge`)
  console.log(`  Has comic keywords (excluded)           : ${review.length.toLocaleString()}  ← HELD, not touched`)

  console.log('\n── Sample: first 30 titles to be purged ─────────────────')
  for (const c of safe.slice(0, 30)) {
    console.log(`  "${c.title.slice(0, 70)}"  [${c.retailers}]`)
  }

  if (review.length > 0) {
    console.log('\n── Excluded (keyword match — not touched) ───────────────')
    for (const c of review.slice(0, 10)) {
      console.log(`  "${c.title.slice(0, 70)}"`)
    }
  }

  if (DRY) {
    console.log('\n── DRY-RUN COMPLETE ─────────────────────────────────────')
    console.log(`  Would soft-delete: ${safe.length.toLocaleString()} canonical products`)
    console.log(`  Would hold:        ${review.length.toLocaleString()} (keyword match)`)
    console.log('\n  Run with --write to execute.')
    console.log('══════════════════════════════════════════════════════════\n')
    return
  }

  // ── WRITE MODE: soft-delete in batches ───────────────────────────────────
  console.log('\n── EXECUTING PURGE ──────────────────────────────────────')
  const ids  = safe.map(c => c.id)
  const now  = new Date()
  const BATCH = 500

  let deleted = 0
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH)
    const result = await prisma.canonicalProduct.updateMany({
      where: { id: { in: chunk }, deletedAt: null },
      data:  { deletedAt: now },
    })
    deleted += result.count
    console.log(`  Batch ${Math.ceil((i + 1) / BATCH)}: soft-deleted ${result.count} (running total: ${deleted})`)
  }

  console.log('\n── Purge complete ───────────────────────────────────────')
  console.log(`  Soft-deleted: ${deleted.toLocaleString()} canonical products`)
  console.log(`  Held (keyword match): ${review.length.toLocaleString()}`)

  // Also soft-delete the retailer_listings for those canonicals
  console.log('\n── Soft-deleting orphaned retailer_listings ─────────────')
  let listingsDeleted = 0
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH)
    const result = await prisma.retailerListing.updateMany({
      where: { canonicalProductId: { in: chunk }, deletedAt: null },
      data:  { deletedAt: now },
    })
    listingsDeleted += result.count
  }
  console.log(`  Soft-deleted: ${listingsDeleted.toLocaleString()} retailer_listings`)

  // Post-purge metric
  const realPages = await prisma.$queryRaw<[{ cnt: number }]>`
    SELECT COUNT(DISTINCT cp.id)::int AS cnt
    FROM canonical_products cp
    WHERE cp.deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id
        WHERE r.domain='travellingman.com' AND rl.canonical_product_id=cp.id
          AND rl.price_amount>0 AND rl.deleted_at IS NULL
      )
      AND (
        SELECT COUNT(DISTINCT rl2.retailer_id) FROM retailer_listings rl2
        WHERE rl2.canonical_product_id=cp.id AND rl2.price_amount>0 AND rl2.deleted_at IS NULL
      ) >= 2
  `

  const tmWordery = await prisma.$queryRaw<[{ cnt: number }]>`
    SELECT COUNT(DISTINCT cp.id)::int AS cnt FROM canonical_products cp
    WHERE cp.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id
                  WHERE r.domain='travellingman.com' AND rl.canonical_product_id=cp.id
                  AND rl.price_amount>0 AND rl.deleted_at IS NULL)
      AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id
                  WHERE r.domain='wordery.com' AND rl.canonical_product_id=cp.id
                  AND rl.price_amount>0 AND rl.deleted_at IS NULL)
  `

  console.log('\n── Post-purge metrics ───────────────────────────────────')
  console.log(`  Real comic comparison pages (TM-anchored): ${realPages[0].cnt.toLocaleString()}`)
  console.log(`  TM + Wordery                             : ${tmWordery[0].cnt.toLocaleString()}`)
  console.log('══════════════════════════════════════════════════════════\n')
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
