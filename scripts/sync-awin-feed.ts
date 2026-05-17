#!/usr/bin/env tsx
/**
 * sync-awin-feed.ts
 *
 * Downloads a fresh AWIN product feed and ingests it directly into the DB.
 * No manual CSV download required — uses AWIN_API_KEY from .env.local.
 *
 * Supports Bookshop.org UK (FID 99173) and any other AWIN merchant.
 *
 * Usage:
 *   npm run sync:awin -- --merchant bookshop           dry-run
 *   npm run sync:awin -- --merchant bookshop --write   write to DB
 *   npm run sync:awin -- --merchant letsbuybooks --write
 *   npm run sync:awin -- --fid 99173 --write           by raw FID
 *   npm run sync:awin -- --merchant bookshop --write --limit 5000
 *
 * Merchants:
 *   bookshop      FID 99173  (uk.bookshop.org)
 *   bookshop-isbn FID 100002 (uk.bookshop.org, ISBN-only feed)
 *   letsbuybooks  FID 112530 (letsbuybooks.com)
 *   speedyhen     FID ?      (speedyhen.com — add FID when approved)
 */

import * as fs      from 'fs'
import * as path    from 'path'
import { Readable } from 'stream'
import { parse }    from 'csv-parse'
import { prisma }   from '../lib/prisma'
import { StockStatus, MatchMethod, ListingCondition } from '@prisma/client'

// ── CLI args ──────────────────────────────────────────────────────────────────
const argv     = process.argv.slice(2)
const WRITE    = argv.includes('--write')
const DRY      = !WRITE
const limIdx   = argv.indexOf('--limit')
const LIMIT    = limIdx !== -1 ? parseInt(argv[limIdx + 1] ?? '999999', 10) : 999_999
const mIdx     = argv.indexOf('--merchant')
const MERCHANT = mIdx !== -1 ? argv[mIdx + 1] : null
const fidIdx   = argv.indexOf('--fid')
const FID_ARG  = fidIdx !== -1 ? argv[fidIdx + 1] : null

// ── Known merchants ───────────────────────────────────────────────────────────
const MERCHANTS: Record<string, { fid: string; domain: string; name: string }> = {
  'bookshop'      : { fid: '99173',  domain: 'uk.bookshop.org',  name: 'Bookshop.org UK' },
  'bookshop-isbn' : { fid: '100002', domain: 'uk.bookshop.org',  name: 'Bookshop.org UK (ISBN feed)' },
  'letsbuybooks'  : { fid: '112530', domain: 'letsbuybooks.com', name: 'Lets Buy Books' },
  // Add when AWIN-approved:
  // 'speedyhen'  : { fid: '???',    domain: 'speedyhen.com',    name: 'SpeedyHen' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function isIsbn13(s: string): boolean {
  return /^97[89]\d{10}$/.test(s?.trim() ?? '')
}

function parsePrice(raw: string): number {
  const n = parseFloat((raw ?? '').replace(/[^0-9.]/g, ''))
  return isNaN(n) ? 0 : n
}

function mapStock(inStock: string, qty: string): StockStatus {
  const v = (inStock ?? '').trim()
  if (v === '1' || v.toLowerCase() === 'yes') return StockStatus.IN_STOCK
  const q = parseInt(qty ?? '0', 10)
  if (q > 0) return StockStatus.IN_STOCK
  return StockStatus.OUT_OF_STOCK
}

// ── Canonical match cache ─────────────────────────────────────────────────────
const canonCache = new Map<string, string>()  // isbn13 → canonical_product_id

async function getCanonicalId(isbn13: string): Promise<string | null> {
  if (canonCache.has(isbn13)) return canonCache.get(isbn13) ?? null
  const cp = await prisma.canonicalProduct.findFirst({
    where: { isbn13, deletedAt: null },
    select: { id: true },
  })
  const id = cp?.id ?? null
  canonCache.set(isbn13, id ?? '')
  return id
}

// ── Retailer cache ────────────────────────────────────────────────────────────
const retailerCache = new Map<string, string>()

async function getRetailerId(domain: string): Promise<string | null> {
  if (retailerCache.has(domain)) return retailerCache.get(domain)!
  const r = await prisma.retailer.findUnique({ where: { domain } })
  if (!r) return null
  retailerCache.set(domain, r.id)
  return r.id
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const apiKey = process.env.AWIN_API_KEY
  if (!apiKey) throw new Error('AWIN_API_KEY not set in environment')

  let fid    : string
  let domain : string
  let name   : string

  if (FID_ARG) {
    fid    = FID_ARG
    domain = 'unknown'
    name   = `FID ${fid}`
  } else if (MERCHANT && MERCHANTS[MERCHANT]) {
    ;({ fid, domain, name } = MERCHANTS[MERCHANT])
  } else {
    console.error(`Unknown merchant: ${MERCHANT}`)
    console.error(`Available: ${Object.keys(MERCHANTS).join(', ')}`)
    console.error(`Or use --fid <feed_id>`)
    process.exit(1)
  }

  console.log('\n══════════════════════════════════════════════════════════')
  console.log(` AWIN Feed Sync — ${name}`)
  console.log(` FID    : ${fid}`)
  console.log(` Domain : ${domain}`)
  console.log(` Mode   : ${DRY ? 'DRY-RUN (pass --write to save)' : 'WRITE'}`)
  console.log(` Limit  : ${LIMIT === 999_999 ? 'unlimited' : LIMIT}`)
  console.log('══════════════════════════════════════════════════════════\n')

  const url = `https://productdata.awin.com/datafeed/download/apikey/${apiKey}/language/en/fid/${fid}/columntypes/all/format/csv/delimiter/%2C/compression/none/`

  console.log(`  Downloading feed from AWIN...`)
  let feedRes: Response
  try {
    feedRes = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  } catch (err) {
    throw new Error(`Feed download failed: ${(err as Error).message}`)
  }

  if (!feedRes.ok) {
    const body = await feedRes.text().catch(() => '')
    throw new Error(`AWIN returned HTTP ${feedRes.status}: ${body.slice(0, 200)}`)
  }

  // Save feed to local file for reference
  const feedsDir = path.join(process.cwd(), 'feeds', 'awin')
  fs.mkdirSync(feedsDir, { recursive: true })
  const today   = new Date().toISOString().slice(0, 10)
  const slug    = MERCHANT ?? `fid${fid}`
  const outFile = path.join(feedsDir, `${slug}-${today}.csv`)

  console.log(`  Saving feed to ${path.relative(process.cwd(), outFile)}...`)

  const body = await feedRes.text()
  fs.writeFileSync(outFile, body, 'utf-8')
  console.log(`  Feed saved (${Math.round(body.length / 1024)}KB)\n`)

  // Get retailer id
  const retailerId = domain !== 'unknown' ? await getRetailerId(domain) : null
  if (domain !== 'unknown' && !retailerId) {
    throw new Error(`Retailer '${domain}' not found in DB. Add it first.`)
  }

  // Parse CSV
  const stats = {
    rows: 0, matched: 0, upserted: 0, priced: 0, skippedNoIsbn: 0,
    skippedNoMatch: 0, skippedNoPrice: 0, errors: 0,
  }

  const parser = parse(body, {
    columns         : true,
    skip_empty_lines: true,
    trim            : true,
    relax_quotes    : true,
    bom             : true,
  })

  for await (const row of parser) {
    stats.rows++
    if (stats.rows > LIMIT) break

    if (stats.rows % 10000 === 0) {
      process.stdout.write(`  Processed ${stats.rows.toLocaleString()} rows...  matched=${stats.matched}, priced=${stats.priced}\r`)
    }

    // Extract ISBN
    const isbn13 =
      isIsbn13(row['isbn'] ?? '')          ? row['isbn'].trim()                  :
      isIsbn13(row['product_barcode'] ?? '') ? row['product_barcode'].trim()     :
      isIsbn13(row['merchant_product_id'] ?? '') ? row['merchant_product_id'].trim() :
      null

    if (!isbn13) { stats.skippedNoIsbn++; continue }

    // Extract price
    const price = parsePrice(row['search_price'] ?? row['price'] ?? row['rrp_price'] ?? '')
    if (price <= 0) { stats.skippedNoPrice++; continue }

    // Match canonical
    const canonicalId = await getCanonicalId(isbn13)
    if (!canonicalId) { stats.skippedNoMatch++; continue }

    stats.matched++

    if (!WRITE) {
      if (stats.matched <= 10) {
        console.log(`  ✓ ${isbn13}  GBP ${price.toFixed(2)}  "${(row['product_name'] ?? '').slice(0, 40)}"`)
      }
      continue
    }

    // Upsert listing
    try {
      const now       = new Date()
      const priceStr  = price.toFixed(2)
      const stockStr  = row['stock_quantity'] ?? ''
      const inStockStr= row['in_stock'] ?? ''
      const stock     = mapStock(inStockStr, stockStr)
      const deepLink  = row['aw_deep_link'] ?? row['product_url'] ?? ''

      const existing = await prisma.retailerListing.findFirst({
        where: { retailerId: retailerId!, isbn13, deletedAt: null },
        select: { id: true, priceAmount: true },
      })

      if (existing) {
        await prisma.retailerListing.update({
          where: { id: existing.id },
          data: { priceAmount: priceStr, priceCurrency: 'GBP', stockStatus: stock, lastSeenAt: now, deletedAt: null },
        })
        if (existing.priceAmount.toString() !== priceStr) {
          await prisma.priceHistory.create({
            data: { retailerListingId: existing.id, priceAmount: priceStr, priceCurrency: 'GBP', stockStatus: stock, recordedAt: now },
          })
        }
      } else {
        const title = (row['product_name'] ?? isbn13).slice(0, 500)
        const productUrl = deepLink || row['product_url'] || `https://${domain}/book/${isbn13}`
        const rl = await prisma.retailerListing.create({
          data: {
            retailerId         : retailerId!,
            canonicalProductId : canonicalId,
            isbn13,
            title,
            retailerSku        : isbn13,
            retailerUrl        : productUrl,
            priceAmount        : priceStr,
            priceCurrency      : 'GBP',
            stockStatus        : stock,
            condition          : ListingCondition.NEW,
            matchMethod        : MatchMethod.ISBN,
            firstSeenAt        : now,
            lastSeenAt         : now,
          },
        })
        await prisma.priceHistory.create({
          data: { retailerListingId: rl.id, priceAmount: priceStr, priceCurrency: 'GBP', stockStatus: stock, recordedAt: now },
        })
      }

      stats.upserted++
      if (price > 0) stats.priced++
    } catch (err) {
      stats.errors++
      console.error(`  [error] ${isbn13}: ${(err as Error).message}`)
    }
  }

  process.stdout.write('\n')
  console.log('\n── Summary ──────────────────────────────────────────────')
  console.log(`  Total rows     : ${stats.rows.toLocaleString()}`)
  console.log(`  Matched (ISBN) : ${stats.matched.toLocaleString()}`)
  console.log(`  Upserted       : ${stats.upserted.toLocaleString()}`)
  console.log(`  Priced         : ${stats.priced.toLocaleString()}`)
  console.log(`  No ISBN        : ${stats.skippedNoIsbn.toLocaleString()}`)
  console.log(`  No match       : ${stats.skippedNoMatch.toLocaleString()}`)
  console.log(`  No price       : ${stats.skippedNoPrice.toLocaleString()}`)
  console.log(`  Errors         : ${stats.errors.toLocaleString()}`)
  if (DRY) {
    console.log('\n  Run with --write to save prices.')
    console.log(`  Feed saved to ${outFile} — inspect before writing.`)
  } else {
    console.log(`\n  ✓ Feed saved to ${outFile}`)
  }
  console.log('══════════════════════════════════════════════════════════\n')
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
