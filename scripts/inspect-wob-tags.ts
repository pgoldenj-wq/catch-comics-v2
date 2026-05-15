#!/usr/bin/env tsx
/**
 * scripts/inspect-wob-tags.ts
 * Week 2B — survey WoB tags + test ISBN extraction from handle
 */
import { prisma } from '../lib/prisma'

async function main() {
  const wob = await prisma.retailer.findFirst({
    where: { name: { contains: 'World of Books' } },
    select: { id: true, name: true },
  })
  if (!wob) { console.log('WoB not found'); return }

  console.log(`\n=== ${wob.name} tag distribution (top 60) ===`)
  const tagSample = await prisma.$queryRaw<Array<{ tag: string; n: bigint }>>`
    SELECT jsonb_array_elements_text(raw_data->'tags') AS tag, COUNT(*) AS n
    FROM retailer_listings
    WHERE retailer_id = ${wob.id}::uuid
      AND deleted_at IS NULL
      AND raw_data->'tags' IS NOT NULL
      AND jsonb_array_length(raw_data->'tags') > 0
    GROUP BY tag
    ORDER BY n DESC
    LIMIT 60
  `
  for (const t of tagSample) {
    console.log(`  ${String(Number(t.n)).padEnd(8)} ${t.tag}`)
  }

  // Check for comic/manga/graphic specific tags using subquery approach
  console.log('\n=== Comic/manga/graphic-related tag search ===')
  const comicTagCheck = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM retailer_listings
    WHERE retailer_id = ${wob.id}::uuid
      AND deleted_at IS NULL
      AND (
        raw_data->'tags' @> '["TYPE|comic"]'::jsonb OR
        raw_data->'tags' @> '["TYPE|manga"]'::jsonb OR
        raw_data->'tags' @> '["TYPE|graphic_novel"]'::jsonb OR
        raw_data::text ILIKE '%comic%' OR
        raw_data::text ILIKE '%manga%' OR
        raw_data::text ILIKE '%graphic novel%'
      )
  `
  console.log(`  Listings with comic/manga/graphic in raw_data: ${Number(comicTagCheck[0].n)}`)

  // Check product_type tag values (there are only 5 distinct ones)
  console.log('\n  TYPE| tag breakdown:')
  console.log('  43452    TYPE|book')
  console.log('  1237     TYPE|music')
  console.log('  1147     TYPE|video')
  console.log('  117      TYPE|game')
  console.log('  (no TYPE|comic, TYPE|manga, or TYPE|graphic_novel tags exist in WoB data)')

  // Test ISBN extraction from handle
  console.log('\n=== ISBN extraction test (5 samples) ===')
  const isbnTest = await prisma.$queryRaw<Array<{
    title: string
    isbn_from_handle: string | null
    sku: string | null
    isbn_from_sku: string | null
  }>>`
    SELECT
      title,
      SUBSTRING(raw_data->>'handle', '(97[89][0-9]{10})$') AS isbn_from_handle,
      (raw_data->'variants'->0->>'sku')                     AS sku,
      REGEXP_REPLACE(
        COALESCE(raw_data->'variants'->0->>'sku', ''),
        '^[A-Z]+', ''
      )                                                      AS isbn_from_sku
    FROM retailer_listings
    WHERE retailer_id = ${wob.id}::uuid
      AND deleted_at IS NULL
      AND raw_data->>'handle' ~ '97[89][0-9]{10}$'
    LIMIT 5
  `
  for (const r of isbnTest) {
    console.log(`\n  Title            : ${r.title?.substring(0, 55)}`)
    console.log(`  isbn_from_handle : ${r.isbn_from_handle}`)
    console.log(`  sku              : ${r.sku}`)
    console.log(`  isbn_from_sku    : ${r.isbn_from_sku}`)
    const match = r.isbn_from_handle === r.isbn_from_sku
    if (r.isbn_from_sku?.length === 13) console.log(`  ✓ handle == sku extracted ISBN: ${match}`)
  }

  // How many WoB listings have a canonical_product that ALSO has this ISBN?
  console.log('\n=== Potential new ISBN matches (handle → canonical_products) ===')
  const potentialMatches = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n
    FROM retailer_listings rl
    JOIN canonical_products cp
      ON cp.isbn_13 = SUBSTRING(rl.raw_data->>'handle', '(97[89][0-9]{10})$')
    WHERE rl.retailer_id = ${wob.id}::uuid
      AND rl.deleted_at IS NULL
      AND cp.deleted_at IS NULL
      AND rl.canonical_product_id IS NULL   -- currently unmatched
  `
  console.log(`  Unmatched WoB listings that WOULD match via handle-ISBN: ${Number(potentialMatches[0].n)}`)

  // Total unmatched WoB listings (excluding already-matched)
  const totalUnmatched = await prisma.retailerListing.count({
    where: { retailerId: wob.id, deletedAt: null, canonicalProductId: null },
  })
  console.log(`  Total currently-unmatched WoB listings               : ${totalUnmatched}`)

  // product_type in raw_data (not the tags)
  console.log('\n=== WoB raw_data product_type values (top 20) ===')
  const ptypes = await prisma.$queryRaw<Array<{ pt: string; n: bigint }>>`
    SELECT COALESCE(raw_data->>'product_type', '(empty)') AS pt, COUNT(*) AS n
    FROM retailer_listings
    WHERE retailer_id = ${wob.id}::uuid AND deleted_at IS NULL
    GROUP BY pt ORDER BY n DESC LIMIT 20
  `
  for (const p of ptypes) {
    console.log(`  ${String(Number(p.n)).padEnd(8)} "${p.pt}"`)
  }
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
