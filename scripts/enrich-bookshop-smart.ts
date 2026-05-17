#!/usr/bin/env tsx
/**
 * Bookshop.org UK — TM-prioritised Price Enrichment
 *
 * Like enrich-bookshop-prices.ts, but prioritises canonical products that
 * Travelling Man already stocks. Enriching TM-linked stubs gives us real
 * comparison pages immediately.
 *
 * Bookshop.org has no aggressive rate limiting — 1.5s delay, ~400 req/hr.
 * No 429 handling needed; JSON-LD extraction is extremely reliable.
 *
 * Usage:
 *   npm run enrich:bookshop:smart                        dry-run
 *   npm run enrich:bookshop:smart -- --write
 *   npm run enrich:bookshop:smart -- --limit 500 --write
 */

import { prisma } from '../lib/prisma'
import { Prisma, StockStatus } from '@prisma/client'

const args   = process.argv.slice(2)
const WRITE  = args.includes('--write')
const DRY    = !WRITE
const limIdx = args.indexOf('--limit')
const LIMIT  = limIdx !== -1 ? parseInt(args[limIdx + 1] ?? '200', 10) : 200

const HEADERS = {
  'User-Agent'               : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept'                   : 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language'          : 'en-GB,en;q=0.9',
  'Accept-Encoding'          : 'gzip, deflate, br',
  'Connection'               : 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest'           : 'document',
  'Sec-Fetch-Mode'           : 'navigate',
  'Sec-Fetch-Site'           : 'none',
  'Sec-Fetch-User'           : '?1',
  'Cache-Control'            : 'max-age=0',
}

const DELAY_MS = 1500   // 1.5s = ~400 req/hr, well within Bookshop limits

function parseAvailability(schemaUrl: string): StockStatus {
  const tag = schemaUrl.replace('https://schema.org/', '')
  switch (tag) {
    case 'InStock'            : return StockStatus.IN_STOCK
    case 'LimitedAvailability': return StockStatus.LOW_STOCK
    case 'OutOfStock'         : return StockStatus.OUT_OF_STOCK
    case 'PreOrder'           : return StockStatus.PREORDER
    case 'BackOrder'          :
    default                   : return StockStatus.IN_STOCK
  }
}

interface ExtractedOffer {
  price       : number
  currency    : string
  availability: StockStatus
}

async function fetchBookshopOffer(isbn13: string): Promise<ExtractedOffer | null | 'not_found'> {
  const url = `https://uk.bookshop.org/book/${isbn13}`
  let res: Response
  try {
    res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(15_000) })
  } catch (err) {
    console.error(`  [net error] ${isbn13}: ${(err as Error).message}`)
    return null
  }
  if (res.status === 404) return 'not_found'
  if (!res.ok) { console.error(`  [HTTP ${res.status}] ${isbn13}`); return null }
  let html: string
  try { html = await res.text() } catch { return null }

  const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
  if (!ldMatch) { console.warn(`  [no JSON-LD] ${isbn13}`); return null }
  let ld: Record<string, unknown>
  try { ld = JSON.parse(ldMatch[1]!) } catch { return null }
  const offers = ld['offers'] as Record<string, unknown> | undefined
  if (!offers || typeof offers['price'] !== 'number') { console.warn(`  [no offers] ${isbn13}`); return null }
  const price    = offers['price'] as number
  const currency = ((offers['priceCurrency'] as string) ?? 'gbp').toUpperCase()
  const avail    = parseAvailability((offers['availability'] as string) ?? '')
  return { price, currency, availability: avail }
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' Bookshop.org UK — SMART Enrichment (TM-prioritised)')
  console.log(` Mode  : ${DRY ? 'DRY-RUN (pass --write to save)' : 'WRITE'}`)
  console.log(` Limit : ${LIMIT}`)
  console.log('══════════════════════════════════════════════════════════\n')

  // TM-linked stubs first (products TM stocks = confirmed comics we want)
  // then non-TM-linked stubs to fill the batch
  const stubs = await prisma.$queryRaw<Array<{ id: string; isbn13: string; price_amount: string; tm_linked: boolean }>>`
    SELECT rl.id, rl.isbn_13 AS isbn13, rl.price_amount,
      EXISTS (
        SELECT 1 FROM retailer_listings tm JOIN retailers tmr ON tmr.id=tm.retailer_id
        WHERE tmr.domain='travellingman.com' AND tm.canonical_product_id=rl.canonical_product_id
          AND tm.deleted_at IS NULL AND tm.price_amount>0
      ) AS tm_linked
    FROM retailer_listings rl
    JOIN retailers r ON r.id=rl.retailer_id
    WHERE r.domain='uk.bookshop.org'
      AND rl.deleted_at IS NULL
      AND rl.price_amount <= 0
      AND rl.isbn_13 IS NOT NULL
    ORDER BY
      -- TM-linked first, then by first_seen_at
      (EXISTS (
        SELECT 1 FROM retailer_listings tm JOIN retailers tmr ON tmr.id=tm.retailer_id
        WHERE tmr.domain='travellingman.com' AND tm.canonical_product_id=rl.canonical_product_id
          AND tm.deleted_at IS NULL AND tm.price_amount>0
      )) DESC,
      rl.first_seen_at ASC
    LIMIT ${LIMIT}
  `

  const tmCount = stubs.filter(s => s.tm_linked).length
  console.log(`  Found ${stubs.length} stubs (${tmCount} TM-linked → direct comparison pages)\n`)

  const stats = { fetched: 0, priced: 0, notFound: 0, errors: 0, tmLinkedPriced: 0 }

  for (const stub of stubs) {
    const isbn = stub.isbn13
    stats.fetched++

    const result = await fetchBookshopOffer(isbn)

    if (result === 'not_found') {
      process.stdout.write(`  ✗ not found  ${isbn}\n`)
      stats.notFound++
    } else if (result === null) {
      process.stdout.write(`  ✗ error      ${isbn}\n`)
      stats.errors++
    } else {
      const { price, currency, availability } = result
      const tmTag = stub.tm_linked ? '  [TM]' : ''
      process.stdout.write(`  ✓ found      ${isbn}  ${currency} ${price.toFixed(2)}  [${availability}]${tmTag}\n`)

      if (WRITE) {
        const priceStr = price.toFixed(2)
        const now = new Date()
        await prisma.retailerListing.update({
          where: { id: stub.id },
          data: { priceAmount: priceStr, priceCurrency: currency, stockStatus: availability, lastSeenAt: now, deletedAt: null },
        })
        await prisma.priceHistory.create({
          data: { retailerListingId: stub.id, priceAmount: priceStr, priceCurrency: currency, stockStatus: availability, recordedAt: now },
        })
        process.stdout.write(`    → written\n`)
      } else {
        process.stdout.write(`    → (dry-run)\n`)
      }
      stats.priced++
      if (stub.tm_linked) stats.tmLinkedPriced++
    }

    if (stats.fetched < stubs.length) await new Promise(r => setTimeout(r, DELAY_MS))
  }

  console.log('\n── Summary ──────────────────────────────────────────────')
  console.log(`  Fetched         : ${stats.fetched}`)
  console.log(`  Priced          : ${stats.priced}  (${stats.fetched > 0 ? Math.round(stats.priced/stats.fetched*100) : 0}%)`)
  console.log(`  TM-linked priced: ${stats.tmLinkedPriced}  ← new comparison pages`)
  console.log(`  Not found       : ${stats.notFound}`)
  console.log(`  Errors          : ${stats.errors}`)
  if (DRY) console.log('\n  Run with --write to save prices.')
  console.log('══════════════════════════════════════════════════════════\n')
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
