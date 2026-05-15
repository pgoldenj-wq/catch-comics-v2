#!/usr/bin/env tsx
/**
 * scripts/cleanup-tm-non-comics.ts
 *
 * Soft-deletes Travelling Man retailer_listings whose Shopify product_type is
 * NOT in the comic/manga allowlist. Dry-run by default.
 *
 * These listings were ingested by the first full sync (before the comic_filter
 * flag was available in ShopifyAdapter). Soft-delete (setting deleted_at) is
 * preferred over hard-delete so the records can be audited and restored.
 *
 * Usage:
 *   npx tsx scripts/cleanup-tm-non-comics.ts           # dry-run (safe default)
 *   npx tsx scripts/cleanup-tm-non-comics.ts --live    # apply soft-deletes
 *
 * What "comic" means here — any Shopify product_type in:
 *   manga, graphic novel, comic, comics, trade paperback, hardcover, single issue
 *
 * Everything else (board games, miniatures, stationery, merchandise …) is
 * soft-deleted. Products with a blank / null product_type are also soft-deleted
 * because Travelling Man only omits product_type for non-comic merchandise.
 */

import { prisma } from '../lib/prisma'

const DRY_RUN = !process.argv.includes('--live')

const COMIC_PRODUCT_TYPES = new Set([
  'manga',
  'graphic novel',
  'comic',
  'comics',
  'trade paperback',
  'hardcover',
  'single issue',
])

async function main() {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  Travelling Man non-comic soft-delete`)
  console.log(`  Mode : ${DRY_RUN ? 'DRY RUN (pass --live to apply)' : '⚡ LIVE — WRITING TO DB'}`)
  console.log(`${'═'.repeat(60)}\n`)

  // ── 1. Locate Travelling Man ────────────────────────────────────────────────
  const tm = await prisma.retailer.findFirst({
    where: { domain: { contains: 'travellingman' } },
    select: { id: true, domain: true },
  })
  if (!tm) throw new Error('Travelling Man retailer not found — check domain substring')
  console.log(`  Retailer : ${tm.domain}  (${tm.id})\n`)

  // ── 2. Load active listings — extract only product_type, NOT full rawData ──────
  //
  // ⚠ BANDWIDTH NOTE: Never do findMany({ select: { rawData: true } }) on large
  // tables — rawData is 3–8 KB per row and will exhaust Neon's free transfer quota.
  // Use raw SQL to extract only the JSON field you need (raw_data->>'product_type').
  // This reduces transfer from ~150 MB to ~2–3 MB for 25k rows.
  console.log('  Loading active listings (low-bandwidth SQL projection) …')

  const allActive = await prisma.$queryRaw<Array<{
    id:    string
    title: string
    pt:    string   // raw_data->>'product_type', lower-cased
  }>>`
    SELECT
      id,
      title,
      lower(coalesce(raw_data->>'product_type', '')) AS pt
    FROM retailer_listings
    WHERE retailer_id = ${tm.id}::uuid
      AND deleted_at IS NULL
  `
  console.log(`  Total active : ${allActive.length.toLocaleString()}\n`)

  // ── 3. Partition ────────────────────────────────────────────────────────────
  type Row = typeof allActive[0]
  const toKeep:   Row[] = []
  const toDelete: Row[] = []

  for (const listing of allActive) {
    if (COMIC_PRODUCT_TYPES.has(listing.pt.trim())) toKeep.push(listing)
    else                                             toDelete.push(listing)
  }

  console.log(`  Comics (will keep)    : ${toKeep.length.toLocaleString()}`)
  console.log(`  Non-comics (to purge) : ${toDelete.length.toLocaleString()}`)

  if (toDelete.length === 0) {
    console.log('\n  Nothing to soft-delete — all active listings are already comics. ✓')
    return
  }

  // ── 4. Product-type breakdown of non-comics ─────────────────────────────────
  const typeCounts = new Map<string, number>()
  for (const listing of toDelete) {
    const pt = listing.pt || '(blank/null)'
    typeCounts.set(pt, (typeCounts.get(pt) ?? 0) + 1)
  }

  console.log('\n  Non-comic product_type breakdown:')
  const sorted = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])
  for (const [pt, count] of sorted.slice(0, 25)) {
    console.log(`    ${count.toString().padStart(6)}  ${pt}`)
  }
  if (sorted.length > 25) {
    console.log(`    … and ${sorted.length - 25} more product types`)
  }

  // ── 5. Sample non-comic listings ────────────────────────────────────────────
  console.log('\n  Sample non-comic listings (first 15):')
  for (const listing of toDelete.slice(0, 15)) {
    const pt    = listing.pt || '(none)'
    const title = listing.title.length > 70 ? listing.title.slice(0, 70) + '…' : listing.title
    console.log(`    [${pt}] ${title}`)
  }
  if (toDelete.length > 15) {
    console.log(`    … and ${toDelete.length - 15} more`)
  }

  // ── 6. Dry-run bail-out ─────────────────────────────────────────────────────
  if (DRY_RUN) {
    console.log('\n  [dry-run] No changes written. Run with --live to apply.')
    return
  }

  // ── 7. Soft-delete in batches ───────────────────────────────────────────────
  const now  = new Date()
  const ids  = toDelete.map(l => l.id)
  const BATCH_SIZE = 500
  let   totalDeleted = 0

  console.log(`\n  Soft-deleting ${ids.length.toLocaleString()} listings in batches of ${BATCH_SIZE} …`)
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch  = ids.slice(i, i + BATCH_SIZE)
    const result = await prisma.retailerListing.updateMany({
      where: { id: { in: batch } },
      data:  { deletedAt: now },
    })
    totalDeleted += result.count
    const batchNum = Math.ceil((i + BATCH_SIZE) / BATCH_SIZE)
    const totalBatches = Math.ceil(ids.length / BATCH_SIZE)
    process.stdout.write(`\r    Batch ${batchNum}/${totalBatches} — ${totalDeleted.toLocaleString()} rows written`)
  }
  console.log()

  // ── 8. Final state ──────────────────────────────────────────────────────────
  const remainingActive = await prisma.retailerListing.count({
    where: { retailerId: tm.id, deletedAt: null },
  })
  const totalSoftDeleted = await prisma.retailerListing.count({
    where: { retailerId: tm.id, deletedAt: { not: null } },
  })

  console.log('\n  ── Final state ──────────────────────────────────────────────')
  console.log(`  Soft-deleted this run : ${totalDeleted.toLocaleString()}`)
  console.log(`  Active remaining      : ${remainingActive.toLocaleString()}`)
  console.log(`  Total soft-deleted    : ${totalSoftDeleted.toLocaleString()}`)
  console.log('\n  ✓ Done.')
  console.log('  Next: set sync_config.comic_filter=true on the TM retailer row')
  console.log('        so future syncs skip non-comics automatically.')
}

main()
  .catch(err => { console.error('\n❌ Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
