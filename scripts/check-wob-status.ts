#!/usr/bin/env tsx
/**
 * scripts/check-wob-status.ts
 * Week 2B — check World of Books and all retailers in DB
 */
import { prisma } from '../lib/prisma'

async function main() {
  const retailers = await prisma.retailer.findMany({
    select: {
      id: true, name: true, domain: true, platform: true,
      isActive: true, trustScore: true, syncConfig: true,
      _count: { select: { listings: true } },
    },
    orderBy: { name: 'asc' },
  })

  console.log('\n=== Retailers in DB ===')
  console.log('name'.padEnd(30) + 'platform'.padEnd(20) + 'active'.padEnd(8) + 'listings')
  console.log('─'.repeat(72))
  for (const r of retailers) {
    const cfg = r.syncConfig as Record<string, unknown> | null
    const comicFilter = cfg?.comic_filter ? ' [comic_filter=true]' : ''
    console.log(
      r.name.padEnd(30) +
      r.platform.padEnd(20) +
      String(r.isActive).padEnd(8) +
      String(r._count.listings) +
      comicFilter
    )
  }

  // Check each retailer's active/matched stats
  console.log('\n=== Per-retailer active + matched listing stats ===')
  console.log('name'.padEnd(30) + 'total'.padEnd(10) + 'active'.padEnd(10) + 'matched'.padEnd(10) + 'match%')
  console.log('─'.repeat(72))
  for (const r of retailers) {
    const total   = await prisma.retailerListing.count({ where: { retailerId: r.id, deletedAt: null } })
    const active  = await prisma.retailerListing.count({ where: { retailerId: r.id, deletedAt: null, stockStatus: { in: ['IN_STOCK','LOW_STOCK','PREORDER'] } } })
    const matched = await prisma.retailerListing.count({ where: { retailerId: r.id, deletedAt: null, canonicalProductId: { not: null } } })
    const matchPct = total > 0 ? ((matched / total) * 100).toFixed(0) + '%' : 'n/a'
    console.log(r.name.padEnd(30) + String(total).padEnd(10) + String(active).padEnd(10) + String(matched).padEnd(10) + matchPct)
  }

  // World of Books deep dive
  const wob = retailers.find(r =>
    (r.domain ?? '').includes('wob') ||
    r.name.toLowerCase().includes('world of books')
  )

  if (!wob) {
    console.log('\nWorld of Books NOT found in retailers table.')
    return
  }

  console.log(`\n=== World of Books deep dive (id: ${wob.id}) ===`)

  // ISBN coverage in raw_data
  const withIsbn = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM retailer_listings
    WHERE retailer_id = ${wob.id}::uuid
      AND deleted_at IS NULL
      AND (
        raw_data->>'isbn'   IS NOT NULL OR
        raw_data->>'isbn13' IS NOT NULL OR
        raw_data->>'isbn_13' IS NOT NULL OR
        raw_data->>'barcode' IS NOT NULL OR
        raw_data->>'ean'    IS NOT NULL
      )
  `
  const totalWob = await prisma.retailerListing.count({ where: { retailerId: wob.id, deletedAt: null } })
  const isbnCount = Number(withIsbn[0].n)
  console.log(`ISBN/barcode in raw_data : ${isbnCount} / ${totalWob} (${totalWob > 0 ? ((isbnCount / totalWob) * 100).toFixed(1) : 'n/a'}%)`)

  // Condition breakdown
  const conditions = await prisma.$queryRaw<Array<{ condition: string; n: bigint }>>`
    SELECT condition::text AS condition, COUNT(*) AS n
    FROM retailer_listings
    WHERE retailer_id = ${wob.id}::uuid AND deleted_at IS NULL
    GROUP BY condition ORDER BY n DESC
  `
  console.log('\nCondition breakdown:')
  for (const c of conditions) {
    console.log(`  ${c.condition.padEnd(14)} ${Number(c.n)}`)
  }

  // Price range
  const prices = await prisma.$queryRaw<Array<{ min_p: number; max_p: number; avg_p: number }>>`
    SELECT
      MIN(price_amount)::float AS min_p,
      MAX(price_amount)::float AS max_p,
      ROUND(AVG(price_amount)::numeric, 2)::float AS avg_p
    FROM retailer_listings
    WHERE retailer_id = ${wob.id}::uuid
      AND deleted_at IS NULL
      AND stock_status IN ('IN_STOCK','LOW_STOCK','PREORDER')
  `
  if (prices[0]) {
    console.log(`\nPrice range (active): £${prices[0].min_p} – £${prices[0].max_p}  avg £${prices[0].avg_p}`)
  }

  // Match rate to comics specifically
  const matchedToComic = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n
    FROM retailer_listings rl
    JOIN canonical_products cp ON cp.id = rl.canonical_product_id
    WHERE rl.retailer_id = ${wob.id}::uuid
      AND rl.deleted_at IS NULL
      AND cp.deleted_at IS NULL
      AND cp.format NOT IN ('OTHER')
  `
  console.log(`Matched to non-OTHER canonical : ${Number(matchedToComic[0].n)}`)

  // Sample active listings
  const sample = await prisma.retailerListing.findMany({
    where: { retailerId: wob.id, deletedAt: null, stockStatus: { in: ['IN_STOCK','LOW_STOCK','PREORDER'] } },
    select: { title: true, priceAmount: true, priceCurrency: true, condition: true, canonicalProductId: true },
    take: 15,
    orderBy: { lastSeenAt: 'desc' },
  })
  console.log('\nSample active WoB listings (newest):')
  for (const l of sample) {
    const matched = l.canonicalProductId ? '✓' : '✗'
    console.log(`  [${matched}] ${l.condition?.padEnd(10)} £${String(l.priceAmount).padEnd(7)} ${l.title?.substring(0, 45)}`)
  }

  // Noise check — listings with canonicals that are now soft-deleted
  const linkedToDeleted = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n
    FROM retailer_listings rl
    JOIN canonical_products cp ON cp.id = rl.canonical_product_id
    WHERE rl.retailer_id = ${wob.id}::uuid
      AND rl.deleted_at IS NULL
      AND cp.deleted_at IS NOT NULL
  `
  console.log(`\nLinked to soft-deleted canonicals : ${Number(linkedToDeleted[0].n)} (noise still in DB)`)
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
