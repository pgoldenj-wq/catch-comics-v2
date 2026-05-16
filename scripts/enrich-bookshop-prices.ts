#!/usr/bin/env tsx
/**
 * scripts/enrich-bookshop-prices.ts
 *
 * Fetches live prices for Bookshop.org UK stub listings via JSON-LD extraction.
 * Promotes stubs (priceAmount=0) to real listings with price + availability.
 *
 * Extraction method: JSON-LD <script type="application/ld+json"> on each product
 * page. Bookshop.org emits structured data on every page — price, currency,
 * availability — no CSS selectors required.
 *
 * Usage:
 *   npm run enrich:bookshop                         dry-run (default)
 *   npm run enrich:bookshop -- --write              write prices to DB
 *   npm run enrich:bookshop -- --limit 50 --write
 *   npm run enrich:bookshop -- --limit 50           dry-run, 50 listings
 *
 * Rate limiting: 1.5s between requests.
 * Anti-bot: standard browser UA + Accept headers — no Cloudflare on Bookshop.
 */

import { prisma } from '../lib/prisma'
import { Prisma, StockStatus } from '@prisma/client'

// ── CLI args ──────────────────────────────────────────────────────────────────

const args   = process.argv.slice(2)
const WRITE  = args.includes('--write')
const DRY    = !WRITE
const limIdx = args.indexOf('--limit')
const LIMIT  = limIdx !== -1 ? parseInt(args[limIdx + 1] ?? '100', 10) : 100

// ── Constants ─────────────────────────────────────────────────────────────────

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

const DELAY_MS = 1500

// ── Extraction ────────────────────────────────────────────────────────────────

interface ExtractedOffer {
  price        : number
  currency     : string   // uppercase e.g. "GBP"
  availability : StockStatus
  finalUrl     : string
}

/** Map schema.org availability URL to our StockStatus enum. */
function parseAvailability(schemaUrl: string): StockStatus {
  const tag = schemaUrl.replace('https://schema.org/', '')
  switch (tag) {
    case 'InStock'            : return StockStatus.IN_STOCK
    case 'LimitedAvailability': return StockStatus.LOW_STOCK
    case 'OutOfStock'         : return StockStatus.OUT_OF_STOCK
    case 'PreOrder'           : return StockStatus.PREORDER
    case 'BackOrder'          :
    default                   : return StockStatus.IN_STOCK   // BackOrder = price exists, orderable
  }
}

async function fetchBookshopOffer(isbn13: string): Promise<ExtractedOffer | null | 'not_found'> {
  const url = `https://uk.bookshop.org/book/${isbn13}`

  let res: Response
  try {
    res = await fetch(url, {
      headers: HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
  } catch (err) {
    console.error(`  [net error] ${isbn13}: ${(err as Error).message}`)
    return null
  }

  if (res.status === 404) return 'not_found'

  if (!res.ok) {
    console.error(`  [HTTP ${res.status}] ${isbn13}`)
    return null
  }

  let html: string
  try {
    html = await res.text()
  } catch {
    return null
  }

  // Extract JSON-LD block
  const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
  if (!ldMatch) {
    console.warn(`  [no JSON-LD] ${isbn13} — page structure may have changed`)
    return null
  }

  let ld: Record<string, unknown>
  try {
    ld = JSON.parse(ldMatch[1]!)
  } catch {
    console.warn(`  [JSON parse error] ${isbn13}`)
    return null
  }

  const offers = ld['offers'] as Record<string, unknown> | undefined
  if (!offers || typeof offers['price'] !== 'number') {
    console.warn(`  [no offers] ${isbn13}`)
    return null
  }

  const price    = offers['price'] as number
  const currency = ((offers['priceCurrency'] as string) ?? 'gbp').toUpperCase()
  const avail    = parseAvailability((offers['availability'] as string) ?? '')

  return { price, currency, availability: avail, finalUrl: res.url }
}

// ── DB update ─────────────────────────────────────────────────────────────────

async function enrichListing(
  id         : string,
  isbn13     : string,
  oldPrice   : Prisma.Decimal,
  offer      : ExtractedOffer,
): Promise<'updated' | 'price_changed'> {
  const priceAmount  = offer.price.toFixed(2)
  const now          = new Date()
  const priceChanged = !oldPrice.equals(new Prisma.Decimal(priceAmount))

  await prisma.retailerListing.update({
    where: { id },
    data: {
      priceAmount  : priceAmount,
      priceCurrency: offer.currency,
      stockStatus  : offer.availability,
      lastSeenAt   : now,
      deletedAt    : null,
    },
  })

  if (priceChanged) {
    await prisma.priceHistory.create({
      data: {
        retailerListingId: id,
        priceAmount,
        priceCurrency    : offer.currency,
        stockStatus      : offer.availability,
        recordedAt       : now,
      },
    })
    return 'price_changed'
  }

  return 'updated'
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' Bookshop.org UK — Price Enrichment')
  console.log(` Mode  : ${DRY ? 'DRY-RUN (pass --write to save)' : 'WRITE'}`)
  console.log(` Limit : ${LIMIT}`)
  console.log('══════════════════════════════════════════════════════════\n')

  // Fetch stub listings
  const stubs = await prisma.retailerListing.findMany({
    where: {
      retailer  : { domain: 'uk.bookshop.org' },
      deletedAt : null,
      priceAmount: { lte: 0 },
      isbn13    : { not: null },
    },
    select  : { id: true, isbn13: true, priceAmount: true },
    take    : LIMIT,
    orderBy : { firstSeenAt: 'asc' },
  })

  console.log(`Found ${stubs.length} stubs to enrich (limit ${LIMIT})\n`)

  const stats = { fetched: 0, priced: 0, notFound: 0, errors: 0, skipped: 0 }

  for (const stub of stubs) {
    const isbn = stub.isbn13!
    stats.fetched++

    const result = await fetchBookshopOffer(isbn)

    if (result === 'not_found') {
      console.log(`  ✗ not found  ${isbn}`)
      stats.notFound++
    } else if (result === null) {
      console.log(`  ✗ error      ${isbn}`)
      stats.errors++
    } else {
      const { price, currency, availability } = result
      const stockLabel = StockStatus[availability] ?? availability
      console.log(`  ✓ found      ${isbn}  ${currency} ${price.toFixed(2)}  [${stockLabel}]`)

      if (WRITE) {
        const outcome = await enrichListing(stub.id, isbn, stub.priceAmount, result)
        if (outcome === 'price_changed') console.log(`    → price_changed (was ${stub.priceAmount})`)
      } else {
        console.log(`    → (dry-run, not written)`)
      }
      stats.priced++
    }

    // Rate limit
    if (stats.fetched < stubs.length) await new Promise(r => setTimeout(r, DELAY_MS))
  }

  console.log('\n── Summary ──────────────────────────────────────────────')
  console.log(`  Fetched   : ${stats.fetched}`)
  console.log(`  Priced    : ${stats.priced}`)
  console.log(`  Not found : ${stats.notFound}  (book not in Bookshop catalog)`)
  console.log(`  Errors    : ${stats.errors}`)
  if (DRY) console.log('\n  Run with --write to save prices.')
  console.log('══════════════════════════════════════════════════════════\n')
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
