#!/usr/bin/env tsx
/**
 * scripts/qa-shortlist.ts
 *
 * Generates the Day 5C QA shortlist — 20 products spread across
 * Marvel / DC / manga / omnibus / TPB / edge-case categories,
 * all matched to Travelling Man listings.
 *
 * Usage: npx dotenv -e .env.local -- npx tsx scripts/qa-shortlist.ts
 */

import { prisma } from '../lib/prisma'

async function main() {
  // All canonical products that have at least one active TM listing
  const rows = await prisma.$queryRaw<Array<{
    slug:        string
    title:       string
    publisher:   string | null
    format:      string
    isbn13:      string | null
    cover_url:   string | null
    listing_id:  string
    retailer_url: string
    price:       string
    currency:    string
    stock:       string
  }>>`
    SELECT
      cp.canonical_slug   AS slug,
      cp.title,
      cp.publisher,
      cp.format::text     AS format,
      cp.isbn_13          AS isbn13,
      cp.cover_image_url  AS cover_url,
      rl.id               AS listing_id,
      rl.retailer_url,
      rl.price_amount::text AS price,
      rl.price_currency   AS currency,
      rl.stock_status::text AS stock
    FROM canonical_products cp
    INNER JOIN retailer_listings rl
      ON rl.canonical_product_id = cp.id
      AND rl.deleted_at IS NULL
      AND rl.stock_status IN ('IN_STOCK', 'LOW_STOCK', 'PREORDER')
    INNER JOIN retailers ret
      ON ret.id = rl.retailer_id
      AND ret.domain LIKE '%travellingman%'
    ORDER BY cp.title ASC
  `

  console.log(`\nTotal TM-matched active listings: ${rows.length}\n`)

  // Categorise
  type Row = typeof rows[0]
  const byCategory: Record<string, Row[]> = {
    marvel:   [],
    dc:       [],
    manga:    [],
    omnibus:  [],
    tpb:      [],
    image:    [],
    darkhorse:[],
    other:    [],
  }

  for (const r of rows) {
    const pub = (r.publisher ?? '').toLowerCase()
    const fmt = r.format.toLowerCase()
    const title = r.title.toLowerCase()

    if (title.includes('omnibus') || fmt.includes('omnibus')) {
      byCategory.omnibus.push(r)
    } else if (pub.includes('marvel')) {
      byCategory.marvel.push(r)
    } else if (pub.includes('dc') || pub.includes('dc comics')) {
      byCategory.dc.push(r)
    } else if (fmt.includes('manga') || pub.includes('viz') || pub.includes('yen') || pub.includes('kodansha') || pub.includes('seven seas')) {
      byCategory.manga.push(r)
    } else if (fmt.includes('trade') || fmt.includes('tpb') || fmt.includes('paperback')) {
      byCategory.tpb.push(r)
    } else if (pub.includes('image')) {
      byCategory.image.push(r)
    } else if (pub.includes('dark horse')) {
      byCategory.darkhorse.push(r)
    } else {
      byCategory.other.push(r)
    }
  }

  // Pick sample from each category
  const shortlist: Row[] = []
  const targets: Record<string, number> = {
    marvel: 3, dc: 3, manga: 4, omnibus: 2, tpb: 2, image: 2, darkhorse: 2, other: 2,
  }

  for (const [cat, count] of Object.entries(targets)) {
    const pool = byCategory[cat]
    // Spread evenly across pool
    const step = pool.length > count ? Math.floor(pool.length / count) : 1
    for (let i = 0; i < count && i * step < pool.length; i++) {
      shortlist.push(pool[i * step])
    }
  }

  // Also force-include known weak-spot ISBNs if present
  const WEAK_SPOTS = [
    '9781799507758',  // Absolute Superman Vol. 2
    '9781421584935',  // Naruto: The Seventh Hokage
  ]
  for (const isbn of WEAK_SPOTS) {
    const match = rows.find(r => r.isbn13 === isbn)
    if (match && !shortlist.find(s => s.slug === match.slug)) {
      shortlist.push(match)
    }
  }

  // Pad to 20 if needed
  for (const r of rows) {
    if (shortlist.length >= 20) break
    if (!shortlist.find(s => s.slug === r.slug)) shortlist.push(r)
  }

  console.log(`QA Shortlist (${shortlist.length} products)`)
  console.log('═'.repeat(100))

  for (let i = 0; i < shortlist.length; i++) {
    const r = shortlist[i]
    const coverOk  = r.cover_url ? '✓' : '✗'
    const pubFmt   = `${r.publisher ?? '(no pub)'} / ${r.format}`
    const priceStr = `£${parseFloat(r.price).toFixed(2)}`

    console.log(`\n#${String(i + 1).padStart(2, '0')}  ${r.title}`)
    console.log(`     slug        : /product/${r.slug}`)
    console.log(`     ISBN        : ${r.isbn13 ?? '(none)'}`)
    console.log(`     publisher   : ${r.publisher ?? '⚠ MISSING'}`)
    console.log(`     format      : ${r.format}`)
    console.log(`     cover       : ${coverOk}  ${r.cover_url ? r.cover_url.slice(0, 80) : ''}`)
    console.log(`     price       : ${priceStr} ${r.currency}  [${r.stock}]`)
    console.log(`     listing_id  : ${r.listing_id}`)
    console.log(`     /go/        : /go/${r.listing_id}`)
    console.log(`     TM url      : ${r.retailer_url}`)
  }

  console.log('\n' + '═'.repeat(100))

  // Category summary
  console.log('\nCategory breakdown of full TM-matched catalog:')
  for (const [cat, pool] of Object.entries(byCategory)) {
    console.log(`  ${cat.padEnd(10)}: ${pool.length}`)
  }
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
