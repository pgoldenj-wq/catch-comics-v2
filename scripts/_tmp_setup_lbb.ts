/**
 * One-time: create Lets Buy Books retailer record and inspect their feed rows.
 */
import * as fs from 'fs'
import * as path from 'path'
import { parse } from 'csv-parse'
import { prisma } from '../lib/prisma'

async function main() {
  // 1. Create LBB retailer if missing
  const existing = await prisma.retailer.findUnique({ where: { domain: 'letsbuybooks.com' } })
  if (existing) {
    console.log('LBB retailer already exists:', existing.id)
  } else {
    const lbb = await prisma.retailer.create({
      data: {
        name           : 'Lets Buy Books',
        domain         : 'letsbuybooks.com',
        platform       : 'AWIN_FEED',
        countryCode    : 'GB',
        currency       : 'GBP',
        isActive       : true,
        trustScore     : 70,
        affiliateNetwork: 'awin',
        affiliateId    : '122824',
        syncConfig     : { feed_id: '112530', feed_format: 'csv' },
      },
    })
    console.log('Created LBB retailer:', lbb.id)
  }

  // 2. Sample LBB rows from the feed to understand their catalog
  const feedFile = path.join(process.cwd(), 'feeds', 'awin', 'datafeed_2888331.csv')
  const parser = fs.createReadStream(feedFile).pipe(
    parse({ columns: true, skip_empty_lines: true, trim: true, bom: true, relax_column_count: true })
  )

  const lbbRows: Array<Record<string, string>> = []
  for await (const row of parser as AsyncIterable<Record<string, string>>) {
    if (row['merchant_id']?.trim() === '122824') {
      lbbRows.push(row)
      if (lbbRows.length >= 10) break
    }
  }

  console.log(`\nSample LBB rows (${lbbRows.length}):`)
  for (const r of lbbRows) {
    console.log(`  ISBN: ${r['merchant_product_id']} | Title: ${r['product_name']?.slice(0,50)} | Cat: ${r['merchant_category']} | Price: ${r['search_price']}`)
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
