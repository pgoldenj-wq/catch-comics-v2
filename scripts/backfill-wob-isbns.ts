#!/usr/bin/env tsx
/**
 * scripts/backfill-wob-isbns.ts
 *
 * Backfills isbn_13 for any Shopify retailer whose listings store ISBNs in
 * the product handle or variant SKU but lack the isbn_13 column value.
 *
 * World of Books: handle ends in ISBN, SKU has 3-letter prefix + ISBN.
 * Travelling Man: SKU is a bare ISBN-13 (no prefix).
 * Both are covered by the same extractIsbn13() regex.
 *
 * This script:
 *   1. Finds all retailer_listings (for --domain) with isbn_13 IS NULL
 *   2. Extracts ISBN-13 from raw_data->>'handle' (WoB-style)
 *   3. Falls back to raw_data->'variants'->0->>'sku' (both WoB and TM)
 *   4. Updates isbn_13 column where found
 *
 * Run once after the first Shopify sync, then run seed:canonical.
 *
 * Usage:
 *   npm run backfill:isbns                                (defaults to worldofbooks.com)
 *   npm run backfill:isbns -- --domain travellingman.com
 *   npm run backfill:isbns -- --dry-run
 */

import { prisma } from '../lib/prisma'

const args    = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const domainIdx = args.indexOf('--domain')
const DOMAIN  = domainIdx !== -1 ? args[domainIdx + 1] : 'worldofbooks.com'

/** Extract a 13-digit ISBN starting with 978 or 979 from an arbitrary string */
function extractIsbn13(s: string | null | undefined): string | null {
  if (!s) return null
  const matches = s.match(/97[89]\d{10}/g)
  return matches?.[0] ?? null
}

async function main() {
  console.log(`\nISBN backfill for ${DOMAIN} — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`)

  const retailer = await prisma.retailer.findUnique({ where: { domain: DOMAIN } })
  if (!retailer) {
    console.error(`${DOMAIN} retailer not found in DB`)
    process.exit(1)
  }

  // Load all listings without isbn_13
  const listings = await prisma.$queryRaw<Array<{
    id: string
    title: string
    raw_data: unknown
  }>>`
    SELECT id, title, raw_data
    FROM retailer_listings
    WHERE retailer_id = ${retailer.id}::uuid
      AND isbn_13 IS NULL
  `

  console.log(`  Listings without isbn_13: ${listings.length}`)

  let found = 0
  let updated = 0
  let notFound = 0

  for (const row of listings) {
    const rd = row.raw_data as Record<string, unknown>

    // 1. Try handle — most reliable; WoB handles end in the ISBN
    //    e.g. "mortal-gods-book-sally-a-kenel-9780819168351"
    const handle  = rd.handle as string | null
    let isbn13 = extractIsbn13(handle)

    // 2. Fall back to first variant SKU — format: NLS9780819168351
    if (!isbn13) {
      const variants = (rd.variants ?? []) as Array<Record<string, unknown>>
      const sku = variants[0]?.sku as string | null
      isbn13 = extractIsbn13(sku)
    }

    if (!isbn13) {
      notFound++
      continue
    }

    found++

    if (!DRY_RUN) {
      await prisma.$executeRaw`
        UPDATE retailer_listings
        SET isbn_13 = ${isbn13}
        WHERE id = ${row.id}::uuid
      `
      updated++
    }
  }

  console.log(`  ISBN-13 found   : ${found}`)
  console.log(`  No ISBN found   : ${notFound}`)
  console.log(`  Updated         : ${DRY_RUN ? '(dry-run, skipped)' : updated}`)

  if (!DRY_RUN && updated > 0) {
    console.log(`\n  ✓ Done. Now run: npm run seed:canonical`)
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
      .finally(() => prisma.$disconnect())
