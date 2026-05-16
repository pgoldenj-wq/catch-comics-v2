#!/usr/bin/env tsx
/**
 * scripts/enrich-wordery-prices.ts
 *
 * Fetches live prices for Wordery stub listings via Inertia.js data-page extraction.
 * Promotes stubs (priceAmount=0) to real listings with price + availability.
 *
 * Extraction method: Wordery uses Inertia.js (Vue SSR). Every product page embeds
 * a `data-page` attribute on <div id="inertia-root"> containing HTML-entity-encoded
 * JSON with full price and availability data. No CSS selectors required.
 *
 * Entry URL: search?term={isbn} — follows 302 to canonical product page.
 * A redirect back to /search means the ISBN is not in Wordery's catalogue.
 *
 * Cloudflare Turnstile: activates client-side only. Server-side HTML fetch with
 * a browser UA returns the full Inertia page without challenge.
 *
 * Usage:
 *   npm run enrich:wordery                          dry-run (default)
 *   npm run enrich:wordery -- --write               write prices to DB
 *   npm run enrich:wordery -- --limit 50 --write
 *   npm run enrich:wordery -- --limit 50            dry-run, 50 listings
 *
 * Rate limiting: 2s between requests (conservative for Cloudflare).
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
  'User-Agent'     : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept'         : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
}

const DELAY_MS = 2000

// ── Extraction ────────────────────────────────────────────────────────────────

interface WorderyBook {
  isbn               : string
  title              : string
  priceForPayment    : string    // e.g. "8.99"
  sellingPriceFormatted: string  // e.g. "£8.99"
}

interface WorderyAvailability {
  checkout: {
    available      : boolean
    headerText     : string   // "In stock" | "Not available"
    availabilityText: string
  }
}

interface ExtractedOffer {
  price       : number
  currency    : string       // "GBP"
  availability: StockStatus
  title       : string
  finalUrl    : string
}

function parseInertiaJson(html: string): { book: WorderyBook; availability: WorderyAvailability } | null {
  const marker = 'data-page="'
  const start  = html.indexOf(marker)
  if (start === -1) return null

  // Scan forward to find the closing quote that isn't preceded by HTML entity encoding.
  // The value uses &quot; for internal quotes and &amp; for ampersands,
  // so we look for the first bare " after the attribute start.
  const valueStart = start + marker.length
  let valueEnd     = valueStart
  while (valueEnd < html.length && html[valueEnd] !== '"') valueEnd++

  const encoded = html.slice(valueStart, valueEnd)
  const decoded = encoded
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')

  try {
    const page = JSON.parse(decoded) as {
      props?: { book?: WorderyBook; availability?: WorderyAvailability }
    }
    const book         = page.props?.book
    const availability = page.props?.availability
    if (!book || !availability) return null
    return { book, availability }
  } catch {
    return null
  }
}

async function fetchWorderyOffer(isbn13: string): Promise<ExtractedOffer | null | 'not_found'> {
  const url = `https://www.wordery.com/search?term=${encodeURIComponent(isbn13)}`

  let res: Response
  try {
    res = await fetch(url, {
      headers : HEADERS,
      redirect: 'follow',
      signal  : AbortSignal.timeout(20_000),
    })
  } catch (err) {
    console.error(`  [net error] ${isbn13}: ${(err as Error).message}`)
    return null
  }

  if (!res.ok) {
    console.error(`  [HTTP ${res.status}] ${isbn13}`)
    return null
  }

  // If the redirect landed back on the search page, the ISBN is not in catalogue
  const finalUrl = res.url
  if (finalUrl.includes('/search?term=') || finalUrl.includes('/search?q=')) {
    return 'not_found'
  }

  let html: string
  try {
    html = await res.text()
  } catch {
    return null
  }

  const data = parseInertiaJson(html)
  if (!data) {
    // Fallback: check if it's a search results page (no inertia-root with book data)
    if (html.includes('"component":"SearchPage"') || html.includes('No results found')) {
      return 'not_found'
    }
    console.warn(`  [no data-page] ${isbn13} — Inertia structure may have changed`)
    return null
  }

  const { book, availability } = data
  const price = parseFloat(book.priceForPayment)
  if (isNaN(price) || price <= 0) {
    console.warn(`  [bad price] ${isbn13}: "${book.priceForPayment}"`)
    return null
  }

  const available = availability.checkout.available
  const stockStatus: StockStatus = available ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK

  return {
    price,
    currency    : 'GBP',
    availability: stockStatus,
    title       : book.title,
    finalUrl,
  }
}

// ── DB update ─────────────────────────────────────────────────────────────────

async function enrichListing(
  id      : string,
  oldPrice: Prisma.Decimal,
  offer   : ExtractedOffer,
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
  console.log(' Wordery — Price Enrichment')
  console.log(` Mode  : ${DRY ? 'DRY-RUN (pass --write to save)' : 'WRITE'}`)
  console.log(` Limit : ${LIMIT}`)
  console.log('══════════════════════════════════════════════════════════\n')

  const stubs = await prisma.retailerListing.findMany({
    where: {
      retailer   : { domain: 'wordery.com' },
      deletedAt  : null,
      priceAmount: { lte: 0 },
      isbn13     : { not: null },
    },
    select  : { id: true, isbn13: true, priceAmount: true },
    take    : LIMIT,
    orderBy : { firstSeenAt: 'asc' },
  })

  console.log(`Found ${stubs.length} stubs to enrich (limit ${LIMIT})\n`)

  const stats = { fetched: 0, priced: 0, notFound: 0, errors: 0 }

  for (const stub of stubs) {
    const isbn = stub.isbn13!
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
      const stockLabel = StockStatus[availability] ?? availability
      console.log(`  ✓ found      ${isbn}  ${currency} ${price.toFixed(2)}  [${stockLabel}]  "${result.title}"`)

      if (WRITE) {
        const outcome = await enrichListing(stub.id, stub.priceAmount, result)
        if (outcome === 'price_changed') console.log(`    → price_changed (was ${stub.priceAmount})`)
      } else {
        console.log(`    → (dry-run, not written)`)
      }
      stats.priced++
    }

    // Rate limit — conservative for Cloudflare
    if (stats.fetched < stubs.length) await new Promise(r => setTimeout(r, DELAY_MS))
  }

  console.log('\n── Summary ──────────────────────────────────────────────')
  console.log(`  Fetched   : ${stats.fetched}`)
  console.log(`  Priced    : ${stats.priced}`)
  console.log(`  Not found : ${stats.notFound}  (ISBN not in Wordery catalogue)`)
  console.log(`  Errors    : ${stats.errors}`)
  if (DRY) console.log('\n  Run with --write to save prices.')
  console.log('══════════════════════════════════════════════════════════\n')
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
