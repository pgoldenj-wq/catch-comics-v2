#!/usr/bin/env tsx
/**
 * scripts/inspect-wob-raw-data.ts
 * Week 2B — inspect WoB raw_data structure to assess ISBN extraction potential
 */
import { prisma } from '../lib/prisma'

async function main() {
  const wob = await prisma.retailer.findFirst({
    where: { name: { contains: 'World of Books' } },
    select: { id: true, name: true },
  })
  if (!wob) { console.log('WoB not found'); return }

  // Survey raw_data keys
  const rows = await prisma.$queryRaw<Array<{ raw_data: Record<string, unknown>; title: string; retailer_url: string }>>`
    SELECT raw_data, title, retailer_url
    FROM retailer_listings
    WHERE retailer_id = ${wob.id}::uuid
      AND deleted_at IS NULL
      AND stock_status IN ('IN_STOCK','LOW_STOCK','PREORDER')
    ORDER BY RANDOM()
    LIMIT 10
  `

  const allKeys = new Set<string>()
  for (const r of rows) {
    Object.keys(r.raw_data ?? {}).forEach(k => allKeys.add(k))
  }

  console.log('\n=== WoB raw_data key survey (10 sample rows) ===')
  console.log('Keys present:', [...allKeys].sort().join(', '))

  console.log('\n=== Sample raw_data objects ===')
  for (const r of rows.slice(0, 5)) {
    console.log(`\nTitle: ${r.title?.substring(0, 60)}`)
    console.log(`URL  : ${r.retailer_url?.substring(0, 80)}`)
    console.log('Data :', JSON.stringify(r.raw_data).substring(0, 400))
  }

  // Check URL patterns for ISBN clues
  console.log('\n=== retailer_url patterns (20 samples) ===')
  const urls = await prisma.$queryRaw<Array<{ retailer_url: string; title: string }>>`
    SELECT retailer_url, title
    FROM retailer_listings
    WHERE retailer_id = ${wob.id}::uuid AND deleted_at IS NULL
    ORDER BY RANDOM() LIMIT 20
  `
  for (const r of urls) {
    // Check if ISBN-like pattern (13 digits) appears in URL
    const isbnInUrl = /\b97[89]\d{10}\b/.test(r.retailer_url ?? '')
    const flag = isbnInUrl ? ' ← ISBN IN URL' : ''
    console.log(`${r.retailer_url?.substring(0, 80)}${flag}`)
  }

  // Count URLs that contain an ISBN pattern
  const isbnUrls = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM retailer_listings
    WHERE retailer_id = ${wob.id}::uuid
      AND deleted_at IS NULL
      AND retailer_url ~ '97[89][0-9]{10}'
  `
  console.log(`\nURLs containing ISBN-13 pattern: ${Number(isbnUrls[0].n)}`)

  // Check if any raw_data field contains ISBN-like numbers
  const isbnInData = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(*) AS n FROM retailer_listings
    WHERE retailer_id = ${wob.id}::uuid
      AND deleted_at IS NULL
      AND raw_data::text ~ '97[89][0-9]{10}'
  `
  console.log(`raw_data containing ISBN-13 pattern: ${Number(isbnInData[0].n)}`)

  // Sample of any WoB comic-matched listings — what do those raw_data look like?
  const matchedComics = await prisma.$queryRaw<Array<{ raw_data: Record<string, unknown>; title: string; retailer_url: string }>>`
    SELECT rl.raw_data, rl.title, rl.retailer_url
    FROM retailer_listings rl
    JOIN canonical_products cp ON cp.id = rl.canonical_product_id
    WHERE rl.retailer_id = ${wob.id}::uuid
      AND rl.deleted_at IS NULL
      AND cp.deleted_at IS NULL
      AND cp.format NOT IN ('OTHER')
    ORDER BY RANDOM()
    LIMIT 5
  `
  console.log('\n=== WoB listings matched to non-OTHER canonicals (sample 5) ===')
  for (const r of matchedComics) {
    console.log(`\nTitle: ${r.title?.substring(0, 60)}`)
    console.log(`URL  : ${r.retailer_url?.substring(0, 80)}`)
    console.log('Data :', JSON.stringify(r.raw_data).substring(0, 400))
  }
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
