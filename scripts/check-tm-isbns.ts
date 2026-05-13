#!/usr/bin/env tsx
import { prisma } from '../lib/prisma'

async function main() {
  const tm = await prisma.retailer.findUnique({ where: { domain: 'travellingman.com' } })
  if (!tm) { console.log('TM retailer not found'); return }

  // Look at raw_data of a few listings that sound like books/manga
  const bookish = await prisma.$queryRaw<Array<{
    title: string
    raw_data: Record<string, unknown>
  }>>`
    SELECT title, raw_data
    FROM retailer_listings
    WHERE retailer_id = ${tm.id}::uuid
      AND (
        title ILIKE '%manga%' OR title ILIKE '%vol%' OR title ILIKE '%volume%'
        OR title ILIKE '%graphic%' OR title ILIKE '%comic%'
      )
    LIMIT 5
  `
  console.log(`Found ${bookish.length} book-like listings\n`)
  for (const r of bookish) {
    console.log('Title:', r.title)
    console.log('raw_data keys:', Object.keys(r.raw_data ?? {}))
    // Check for variant barcodes
    const variants = (r.raw_data as any)?.variants as any[]
    if (variants?.length) {
      console.log('First variant barcode:', variants[0]?.barcode)
      console.log('First variant sku:', variants[0]?.sku)
    }
    console.log('product_type:', (r.raw_data as any)?.product_type)
    console.log('tags:', JSON.stringify((r.raw_data as any)?.tags)?.slice(0, 100))
    console.log()
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
