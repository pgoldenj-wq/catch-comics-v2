#!/usr/bin/env tsx
// Check what product_type/tags caused false-positive canonicals
import { prisma } from '../lib/prisma'

const SUSPECTS = ['9780099416449', '9780143570837']

async function main() {
  for (const isbn of SUSPECTS) {
    const rows = await prisma.$queryRaw<Array<{
      isbn_13: string; title: string; retailer_id: string
      product_type: string | null; tags: string | null
    }>>`
      SELECT rl.isbn_13, cp.title, rl.retailer_id::text,
             rl.raw_data->>'product_type' AS product_type,
             (rl.raw_data->'tags')::text  AS tags
      FROM canonical_products cp
      JOIN retailer_listings rl ON rl.canonical_product_id = cp.id
      WHERE cp.isbn_13 = ${isbn}
      LIMIT 3
    `
    for (const r of rows) {
      console.log(`\nISBN: ${r.isbn_13} | "${r.title}"`)
      console.log(`  product_type : ${r.product_type}`)
      console.log(`  tags snippet : ${(r.tags ?? '').slice(0, 300)}`)
    }
  }
}
main().catch(console.error).finally(() => prisma.$disconnect())
