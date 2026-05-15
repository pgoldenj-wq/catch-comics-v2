#!/usr/bin/env tsx
/**
 * scripts/review-tier1-active-listings.ts
 *
 * ④ Tier 1 active-listing review — shows which blocklist publishers have
 *    live listings so we can verify they are truly non-comic before purging.
 *
 * Usage:
 *   npx dotenv -e .env.local -- npx tsx scripts/review-tier1-active-listings.ts
 */

import { prisma } from '../lib/prisma'

const TIER1_PUBLISHERS = [
  'BRILL', 'Brill',
  'Legare Street Press',
  'Kessinger Publishing',
  "McGill-Queen's University Press",
  'Hachette Livre - Bnf',
  'Arotahi Agency',
  'IWA Publishing',
  'Melia Publishing Services Limited',
  'Martinus Nijhoff Publishers',
  'Penguin Random House NZ',
  'Hachette Aotearoa New Zealand',
  'Creative Media Partners LLC',
  'Palala Press',
  'Wentworth Press',
]

async function main() {
  console.log('\n══════════════════════════════════════════════════════════')
  console.log('  Tier 1 blocklist — active listings review')
  console.log('══════════════════════════════════════════════════════════\n')

  // Per-publisher totals
  const pubTotals = await prisma.$queryRaw<Array<{
    publisher: string; canon_count: bigint; listing_count: bigint
  }>>`
    SELECT cp.publisher,
           COUNT(DISTINCT cp.id) AS canon_count,
           COUNT(rl.id)          AS listing_count
    FROM canonical_products cp
    JOIN retailer_listings rl ON rl.canonical_product_id = cp.id
    WHERE rl.stock_status IN ('IN_STOCK','LOW_STOCK','PREORDER')
      AND rl.deleted_at IS NULL
      AND cp.publisher = ANY(${TIER1_PUBLISHERS})
    GROUP BY cp.publisher
    ORDER BY listing_count DESC
  `

  console.log('Publisher                          Canonicals  Listings')
  console.log('─'.repeat(60))
  for (const r of pubTotals) {
    const pub  = (r.publisher ?? '(none)').substring(0, 33).padEnd(35)
    const cans = String(Number(r.canon_count)).padEnd(12)
    console.log(`  ${pub}${cans}${Number(r.listing_count)}`)
  }

  // Top 30 individual titles
  const rows = await prisma.$queryRaw<Array<{
    title: string; publisher: string; format: string; active_listing_count: bigint
  }>>`
    SELECT cp.title, cp.publisher, cp.format::text AS format,
           COUNT(*) AS active_listing_count
    FROM canonical_products cp
    JOIN retailer_listings rl ON rl.canonical_product_id = cp.id
    WHERE rl.stock_status IN ('IN_STOCK','LOW_STOCK','PREORDER')
      AND rl.deleted_at IS NULL
      AND cp.publisher = ANY(${TIER1_PUBLISHERS})
    GROUP BY cp.title, cp.publisher, cp.format
    ORDER BY active_listing_count DESC, cp.publisher, cp.title
    LIMIT 30
  `

  console.log('\nTop 30 individual canonicals with active listings:')
  console.log('─'.repeat(100))
  console.log('publisher'.padEnd(28) + 'fmt'.padEnd(10) + 'n'.padEnd(4) + 'title')
  console.log('─'.repeat(100))
  for (const r of rows) {
    const pub = (r.publisher ?? '').substring(0, 26).padEnd(28)
    const fmt = r.format.padEnd(10)
    const cnt = String(Number(r.active_listing_count)).padEnd(4)
    console.log(`${pub}${fmt}${cnt}${r.title.substring(0, 55)}`)
  }

  // Which retailers are carrying these
  const retailers = await prisma.$queryRaw<Array<{
    name: string; canon_count: bigint; listing_count: bigint
  }>>`
    SELECT ret.name,
           COUNT(DISTINCT cp.id) AS canon_count,
           COUNT(rl.id)          AS listing_count
    FROM canonical_products cp
    JOIN retailer_listings rl ON rl.canonical_product_id = cp.id
    JOIN retailers ret ON ret.id = rl.retailer_id
    WHERE rl.stock_status IN ('IN_STOCK','LOW_STOCK','PREORDER')
      AND rl.deleted_at IS NULL
      AND cp.publisher = ANY(${TIER1_PUBLISHERS})
    GROUP BY ret.name
    ORDER BY listing_count DESC
  `

  console.log('\nRetailers carrying Tier 1 non-comics:')
  console.log('─'.repeat(60))
  for (const r of retailers) {
    const name = (r.name ?? '').padEnd(32)
    console.log(`  ${name}${Number(r.canon_count)} canonicals, ${Number(r.listing_count)} listings`)
  }

  // Sanity check: are any of these comics by format?
  const byFormat = await prisma.$queryRaw<Array<{
    format: string; n: bigint
  }>>`
    SELECT cp.format::text AS format, COUNT(DISTINCT cp.id) AS n
    FROM canonical_products cp
    JOIN retailer_listings rl ON rl.canonical_product_id = cp.id
    WHERE rl.stock_status IN ('IN_STOCK','LOW_STOCK','PREORDER')
      AND rl.deleted_at IS NULL
      AND cp.publisher = ANY(${TIER1_PUBLISHERS})
    GROUP BY cp.format
    ORDER BY n DESC
  `

  console.log('\nFormat breakdown of Tier 1 actives (should all be OTHER):')
  console.log('─'.repeat(40))
  for (const r of byFormat) {
    console.log(`  ${r.format.padEnd(18)} ${Number(r.n)}`)
  }

  // Spot-check Penguin Random House NZ specifically (22 active listings, not in top-30)
  const prhNZ = await prisma.$queryRaw<Array<{
    title: string; format: string
  }>>`
    SELECT cp.title, cp.format::text AS format
    FROM canonical_products cp
    JOIN retailer_listings rl ON rl.canonical_product_id = cp.id
    WHERE rl.stock_status IN ('IN_STOCK','LOW_STOCK','PREORDER')
      AND rl.deleted_at IS NULL
      AND cp.publisher = 'Penguin Random House NZ'
    GROUP BY cp.title, cp.format
    ORDER BY cp.title
    LIMIT 30
  `

  console.log('\nPenguin Random House NZ active titles (spot-check):')
  console.log('─'.repeat(60))
  for (const r of prhNZ) {
    console.log(`  [${r.format.padEnd(14)}] ${r.title.substring(0, 55)}`)
  }

  // Spot-check Melia Publishing (largest non-comic count)
  const melia = await prisma.$queryRaw<Array<{
    title: string; format: string
  }>>`
    SELECT cp.title, cp.format::text AS format
    FROM canonical_products cp
    JOIN retailer_listings rl ON rl.canonical_product_id = cp.id
    WHERE rl.stock_status IN ('IN_STOCK','LOW_STOCK','PREORDER')
      AND rl.deleted_at IS NULL
      AND cp.publisher = 'Melia Publishing Services Limited'
    GROUP BY cp.title, cp.format
    ORDER BY cp.title
    LIMIT 10
  `

  console.log('\nMelia Publishing Services Limited active titles (spot-check):')
  console.log('─'.repeat(60))
  for (const r of melia) {
    console.log(`  [${r.format.padEnd(14)}] ${r.title.substring(0, 55)}`)
  }

  console.log('\n')
}

main()
  .catch(err => { console.error('\n❌ Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
