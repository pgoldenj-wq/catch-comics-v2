#!/usr/bin/env tsx
/**
 * scripts/purge-noncomic-canonicals.ts
 *
 * Deletes canonical_products that are unlikely to be comics:
 *   - format = 'OTHER' AND publisher NOT in the known comics publishers list
 *
 * Also unlinks the retailer_listings so they can be re-seeded correctly.
 *
 * Usage:
 *   npm run purge:noncomic              (live — deletes from DB)
 *   npm run purge:noncomic -- --dry-run (shows what would be deleted)
 */

import { prisma } from '../lib/prisma'

const DRY_RUN = process.argv.includes('--dry-run')

const COMIC_PUBLISHERS = [
  'marvel', 'dc comics', 'image comics', 'image', 'dark horse', 'idw',
  'boom', 'oni press', 'fantagraphics', 'drawn & quarterly', 'viz', 'kodansha',
  'yen press', 'seven seas', 'tokyopop', 'square enix', 'shueisha', 'vertical',
  'titan comics', 'dynamite', 'aftershock', 'vault', 'scout', 'ahoy',
  'top shelf', 'humanoids', 'ablaze', 'valiant', 'archie', 'avatar press',
  'zenescope', 'lion forge', 'abrams', 'first second', 'graphix', 'scholastic',
  'papercutz', 'eurocomics', 'pantheon',
]

async function main() {
  console.log(`\nPurge non-comic canonical products — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`)

  // Fetch all canonical products with format = OTHER
  const candidates = await prisma.$queryRaw<Array<{
    id: string; title: string; publisher: string | null; format: string
  }>>`
    SELECT id, title, publisher, format
    FROM canonical_products
    WHERE format = 'OTHER'
    ORDER BY created_at DESC
  `

  console.log(`  Candidates with format=OTHER: ${candidates.length}`)

  // Filter: keep if publisher matches a known comics publisher
  const toDelete = candidates.filter(c => {
    const pub = (c.publisher ?? '').toLowerCase()
    return !COMIC_PUBLISHERS.some(known => pub.includes(known))
  })

  const toKeep = candidates.length - toDelete.length

  console.log(`  Will delete : ${toDelete.length}`)
  console.log(`  Will keep   : ${toKeep}  (comic publisher detected)`)

  if (toDelete.length === 0) {
    console.log('\n  Nothing to purge.')
    return
  }

  // Show sample of what will be deleted
  console.log('\n  Sample deletions:')
  for (const c of toDelete.slice(0, 10)) {
    console.log(`    - "${c.title}"  publisher: ${c.publisher ?? '(none)'}`)
  }
  if (toDelete.length > 10) {
    console.log(`    ... and ${toDelete.length - 10} more`)
  }

  if (DRY_RUN) {
    console.log('\n  [dry-run] No changes made.')
    return
  }

  const ids = toDelete.map(c => c.id)

  // 1. Unlink retailer_listings (only clear the FK — match_method is NOT NULL)
  const unlinkResult = await prisma.$executeRaw`
    UPDATE retailer_listings
    SET    canonical_product_id = NULL
    WHERE  canonical_product_id = ANY(${ids}::uuid[])
  `
  console.log(`\n  Unlinked listings : ${unlinkResult}`)

  // 2. Delete the canonical products
  const deleteResult = await prisma.$executeRaw`
    DELETE FROM canonical_products
    WHERE id = ANY(${ids}::uuid[])
  `
  console.log(`  Deleted products  : ${deleteResult}`)

  // Final counts
  const remaining = await prisma.canonicalProduct.count()
  const seedable  = await prisma.$queryRaw<[{ n: bigint }]>`
    SELECT COUNT(*) as n FROM retailer_listings WHERE canonical_product_id IS NULL AND isbn_13 IS NOT NULL
  `
  console.log(`\n  canonical_products remaining : ${remaining}`)
  console.log(`  retailer_listings seedable  : ${Number(seedable[0].n)}`)
  console.log(`\n  ✓ Done. Run: npm run seed:canonical to re-seed with comic filter.`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) }).finally(() => prisma.$disconnect())
