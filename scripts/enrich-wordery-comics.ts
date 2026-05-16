#!/usr/bin/env tsx
/**
 * Enrich Wordery stubs that correspond to comic products — specifically
 * canonical products that already have a Travelling Man listing.
 *
 * This guarantees we enrich the right ISBNs first: products that TM sells
 * are the comics we want appearing in the multi-retailer comparison table.
 *
 * Usage:
 *   npm run enrich:wordery:comics                    dry-run
 *   npm run enrich:wordery:comics -- --write
 *   npm run enrich:wordery:comics -- --limit 500 --write
 */

import { prisma } from '../lib/prisma'
import { Prisma, StockStatus } from '@prisma/client'

const args   = process.argv.slice(2)
const WRITE  = args.includes('--write')
const DRY    = !WRITE
const limIdx = args.indexOf('--limit')
const LIMIT  = limIdx !== -1 ? parseInt(args[limIdx + 1] ?? '500', 10) : 500

const HEADERS = {
  'User-Agent'               : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept'                   : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language'          : 'en-GB,en;q=0.9',
  'Accept-Encoding'          : 'gzip, deflate, br',
  'Connection'               : 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest'           : 'document',
  'Sec-Fetch-Mode'           : 'navigate',
  'Sec-Fetch-Site'           : 'none',
  'Sec-Fetch-User'           : '?1',
}

const DELAY_MS = 5000

interface ExtractedOffer {
  price       : number
  currency    : string
  availability: StockStatus
}

function parseInertiaJson(html: string): ExtractedOffer | null {
  const marker = 'data-page="'
  const start  = html.indexOf(marker)
  if (start === -1) return null
  const valueStart = start + marker.length
  let valueEnd     = valueStart
  while (valueEnd < html.length && html[valueEnd] !== '"') valueEnd++

  const decoded = html.slice(valueStart, valueEnd)
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')

  try {
    const page = JSON.parse(decoded) as { props?: { book?: { priceForPayment?: string }; availability?: { checkout?: { available?: boolean } } } }
    const price = parseFloat(page.props?.book?.priceForPayment ?? '')
    if (isNaN(price) || price <= 0) return null
    const available = page.props?.availability?.checkout?.available ?? false
    return { price, currency: 'GBP', availability: available ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK }
  } catch {
    return null
  }
}

async function fetchWorderyOffer(isbn13: string): Promise<ExtractedOffer | null | 'not_found'> {
  const url = `https://www.wordery.com/search?term=${encodeURIComponent(isbn13)}`
  let res: Response
  try {
    res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(20_000) })
  } catch (err) {
    console.error(`  [net error] ${isbn13}: ${(err as Error).message}`)
    return null
  }
  if (!res.ok) { console.error(`  [HTTP ${res.status}] ${isbn13}`); return null }
  const finalUrl = res.url
  if (finalUrl.includes('/search?term=') || finalUrl.includes('/search?q=')) return 'not_found'
  let html: string
  try { html = await res.text() } catch { return null }
  if (html.includes('"component":"SearchPage"') || html.includes('No results found')) return 'not_found'
  const offer = parseInertiaJson(html)
  if (!offer) { console.warn(`  [no data-page] ${isbn13}`); return null }
  return offer
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' Wordery — Comic Price Enrichment (Travelling Man priority)')
  console.log(` Mode  : ${DRY ? 'DRY-RUN (pass --write to save)' : 'WRITE'}`)
  console.log(` Limit : ${LIMIT}`)
  console.log('══════════════════════════════════════════════════════════\n')

  // Find Wordery stubs (price=0) linked to canonicals that Travelling Man also lists.
  // These are confirmed comic products — the ones we most need visible.
  const stubs = await prisma.$queryRaw<Array<{ id: string; isbn13: string; price_amount: string }>>`
    SELECT rl.id, rl.isbn_13 AS isbn13, rl.price_amount
    FROM   retailer_listings rl
    JOIN   retailers r ON r.id = rl.retailer_id
    WHERE  r.domain = 'wordery.com'
      AND  rl.deleted_at IS NULL
      AND  rl.price_amount <= 0
      AND  rl.isbn_13 IS NOT NULL
      AND  EXISTS (
        SELECT 1
        FROM   retailer_listings tm_rl
        JOIN   retailers tm_r ON tm_r.id = tm_rl.retailer_id
        WHERE  tm_r.domain = 'travellingman.com'
          AND  tm_rl.canonical_product_id = rl.canonical_product_id
          AND  tm_rl.deleted_at IS NULL
          AND  tm_rl.price_amount > 0
      )
    ORDER  BY rl.first_seen_at DESC
    LIMIT  ${LIMIT}
  `

  console.log(`Found ${stubs.length} comic Wordery stubs to enrich (TM-linked, limit ${LIMIT})\n`)

  const stats = { fetched: 0, priced: 0, notFound: 0, errors: 0 }

  for (const stub of stubs) {
    const isbn = stub.isbn13
    stats.fetched++

    const result = await fetchWorderyOffer(isbn)

    if (result === 'not_found') {
      console.log(`  ✗ not found  ${isbn}`)
      stats.notFound++
    } else if (result === null) {
      console.log(`  ✗ error      ${isbn}`)
      stats.errors++
    } else {
      const { price, currency, availability } = result
      console.log(`  ✓ found      ${isbn}  ${currency} ${price.toFixed(2)}  [${availability}]`)

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
        console.log(`    → written`)
      } else {
        console.log(`    → (dry-run)`)
      }
      stats.priced++
    }

    if (stats.fetched < stubs.length) await new Promise(r => setTimeout(r, DELAY_MS))
  }

  console.log('\n── Summary ──────────────────────────────────────────────')
  console.log(`  Fetched   : ${stats.fetched}`)
  console.log(`  Priced    : ${stats.priced}`)
  console.log(`  Not found : ${stats.notFound}`)
  console.log(`  Errors    : ${stats.errors}`)
  if (DRY) console.log('\n  Run with --write to save prices.')
  console.log('══════════════════════════════════════════════════════════\n')
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
