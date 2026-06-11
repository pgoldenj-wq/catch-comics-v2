#!/usr/bin/env tsx
/**
 * scripts/ingest-awin-local-feed.ts
 *
 * Ingest a locally-downloaded AWIN CSV feed into retailer_listings.
 *
 * Reads:  feeds/awin/datafeed_2888331.csv  (Bookshop.org UK + Lets Buy Books)
 *
 * Strategy:
 *   1. Parse every row in the CSV.
 *   2. Extract ISBN-13 from merchant_product_id (AWIN uses ISBN as SKU for book merchants).
 *   3. Match against canonical_products by isbn_13 → only comic products match.
 *   4. For each merchant, find the retailer record in our DB.
 *   5. Upsert the retailer_listing (create or update price + stock).
 *   6. Write price_history record if price changed.
 *
 * Usage:
 *   npm run ingest:awin-local                        dry-run
 *   npm run ingest:awin-local -- --write             write to DB
 *   npm run ingest:awin-local -- --write --limit 500
 *   npm run ingest:awin-local -- --write --merchant 62675   (Bookshop only)
 *   npm run ingest:awin-local -- --write --merchant 122824  (Lets Buy Books only)
 */

import * as fs   from 'fs'
import * as path from 'path'
import { parse } from 'csv-parse'
import { prisma } from '../lib/prisma'
import { Prisma, StockStatus, ListingCondition, MatchMethod } from '@prisma/client'

// ── CLI args ──────────────────────────────────────────────────────────────────

const argv     = process.argv.slice(2)
const WRITE    = argv.includes('--write')
const DRY      = !WRITE
const limIdx   = argv.indexOf('--limit')
const LIMIT    = limIdx !== -1 ? parseInt(argv[limIdx + 1] ?? '999999', 10) : 999_999
const midIdx   = argv.indexOf('--merchant')
const MERCHANT_FILTER = midIdx !== -1 ? argv[midIdx + 1] : null

// Merchant ID → retailer domain mapping
const MERCHANT_DOMAINS: Record<string, string> = {
  '62675' : 'uk.bookshop.org',
  '122824': 'letsbuybooks.com',
}

// ── Constants ─────────────────────────────────────────────────────────────────

const FEED_FILE = path.join(process.cwd(), 'feeds', 'awin', 'datafeed_2888331.csv')
const CHUNK_SIZE = 100

// ── Helpers ───────────────────────────────────────────────────────────────────

function isIsbn13(s: string): boolean {
  return /^97[89]\d{10}$/.test(s.trim())
}

function parsePrice(raw: string): string {
  const n = parseFloat(raw.replace(/[^0-9.]/g, ''))
  return isNaN(n) || n <= 0 ? '0.00' : n.toFixed(2)
}

function mapStock(inStock: string): StockStatus {
  const v = inStock.trim()
  return (v === '1' || v.toLowerCase() === 'yes') ? StockStatus.IN_STOCK : StockStatus.OUT_OF_STOCK
}

// ── Retailer cache ────────────────────────────────────────────────────────────

const retailerCache = new Map<string, string>()  // domain → retailer.id

async function getRetailerId(domain: string): Promise<string | null> {
  if (retailerCache.has(domain)) return retailerCache.get(domain)!
  const r = await prisma.retailer.findUnique({ where: { domain } })
  if (!r) return null
  retailerCache.set(domain, r.id)
  return r.id
}

// ── Canonical match cache (ISBN → canonical product id) ───────────────────────

const canonCache = new Map<string, string | null>()

async function getCanonicalId(isbn13: string): Promise<string | null> {
  if (canonCache.has(isbn13)) return canonCache.get(isbn13)!
  const cp = await prisma.canonicalProduct.findFirst({
    where: { isbn13, deletedAt: null },
    select: { id: true },
  })
  const result = cp?.id ?? null
  canonCache.set(isbn13, result)
  return result
}

// ── Upsert one listing ────────────────────────────────────────────────────────

async function upsert(
  retailerId        : string,
  retailerSku       : string,
  retailerUrl       : string,
  title             : string,
  priceAmount       : string,
  currency          : string,
  stockStatus       : StockStatus,
  imageUrl          : string | null,
  canonicalProductId: string | null,
  isbn13            : string | null,
  syncStart         : Date,
): Promise<'created' | 'updated' | 'price_changed'> {
  const existing = await prisma.retailerListing.findFirst({
    where: {
      retailerId,
      OR: [
        { retailerSku },
        ...(isbn13 ? [{ isbn13 }] : []),
      ],
    },
  })

  if (!existing) {
    if (DRY) return 'created'
    await prisma.retailerListing.create({
      data: {
        retailerId,
        retailerSku,
        retailerUrl,
        title,
        priceAmount,
        priceCurrency     : currency,
        stockStatus,
        condition         : ListingCondition.NEW,
        conditionDetail   : null,
        imageUrl,
        isbn13,
        canonicalProductId,
        matchMethod       : canonicalProductId ? MatchMethod.ISBN : MatchMethod.UNMATCHED,
        matchConfidence   : canonicalProductId ? 100 : 0,
        firstSeenAt       : syncStart,
        lastSeenAt        : syncStart,
        rawData           : Prisma.JsonNull,
        priceHistory: {
          create: {
            priceAmount,
            priceCurrency: currency,
            stockStatus,
            recordedAt   : syncStart,
          },
        },
      },
    })
    return 'created'
  }

  const priceChanged = !existing.priceAmount.equals(new Prisma.Decimal(priceAmount))

  // Upgrade UNMATCHED to matched if we now have a canonical ID
  const matchUpgrade = (!existing.canonicalProductId && canonicalProductId)
    ? { canonicalProductId, matchMethod: MatchMethod.ISBN, matchConfidence: 100 }
    : {}

  if (!DRY) {
    await prisma.retailerListing.update({
      where: { id: existing.id },
      data: {
        priceAmount,
        priceCurrency: currency,
        stockStatus,
        retailerUrl,
        title,
        lastSeenAt   : syncStart,
        deletedAt    : null,
        ...matchUpgrade,
      },
    })

    if (priceChanged) {
      await prisma.priceHistory.create({
        data: {
          retailerListingId: existing.id,
          priceAmount,
          priceCurrency    : currency,
          stockStatus,
          recordedAt       : syncStart,
        },
      })
    }
  }

  return priceChanged ? 'price_changed' : 'updated'
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' AWIN Local Feed Ingestion')
  console.log(` Mode     : ${DRY ? 'DRY-RUN (pass --write to save)' : 'WRITE'}`)
  console.log(` File     : ${FEED_FILE}`)
  console.log(` Limit    : ${LIMIT === 999_999 ? 'none' : LIMIT}`)
  console.log(` Merchant : ${MERCHANT_FILTER ?? 'all'}`)
  console.log('══════════════════════════════════════════════════════════\n')

  if (!fs.existsSync(FEED_FILE)) {
    console.error(`Feed file not found: ${FEED_FILE}`)
    process.exit(1)
  }

  const syncStart = new Date()

  const stats: Record<string, { rows: number; comics: number; created: number; updated: number; priceChanged: number; skipped: number }> = {}

  const parser = fs.createReadStream(FEED_FILE).pipe(
    parse({
      columns         : true,
      skip_empty_lines: true,
      trim            : true,
      bom             : true,
      relax_column_count: true,
    })
  )

  let totalRows = 0

  for await (const row of parser as AsyncIterable<Record<string, string>>) {
    if (totalRows >= LIMIT) break
    totalRows++

    const merchantId = row['merchant_id']?.trim()
    if (!merchantId) continue
    if (MERCHANT_FILTER && merchantId !== MERCHANT_FILTER) continue

    const domain = MERCHANT_DOMAINS[merchantId]
    if (!domain) continue  // merchant not in our system

    if (!stats[merchantId]) {
      stats[merchantId] = { rows: 0, comics: 0, created: 0, updated: 0, priceChanged: 0, skipped: 0 }
    }
    stats[merchantId].rows++

    const retailerId = await getRetailerId(domain)
    if (!retailerId) {
      // Retailer not in DB — skip silently (will show in final stats)
      stats[merchantId].skipped++
      continue
    }

    // Extract ISBN-13 from merchant_product_id
    const rawSku    = row['merchant_product_id']?.trim() ?? ''
    const isbn13    = isIsbn13(rawSku) ? rawSku : null

    // Only process rows that match a canonical comic product (or create new listings for comics found)
    const canonicalId = isbn13 ? await getCanonicalId(isbn13) : null

    // Skip if no canonical match (not in our comics DB) — keeps us comic-focused
    if (!canonicalId) {
      stats[merchantId].skipped++
      continue
    }

    stats[merchantId].comics++

    const priceStr  = parsePrice(row['search_price'] ?? '')
    if (priceStr === '0.00') {
      stats[merchantId].skipped++
      continue
    }

    const currency  = (row['currency'] ?? 'GBP').toUpperCase()
    const stock     = mapStock(row['in_stock'] ?? '0')
    const title     = row['product_name'] ?? ''
    const url       = row['merchant_deep_link'] || row['aw_deep_link'] || ''
    const imageUrl  = row['merchant_image_url'] || null

    if (!url) {
      stats[merchantId].skipped++
      continue
    }

    const result = await upsert(
      retailerId, rawSku, url, title, priceStr, currency,
      stock, imageUrl, canonicalId, isbn13, syncStart,
    )

    if (result === 'created')            stats[merchantId].created++
    else if (result === 'price_changed') stats[merchantId].priceChanged++
    else                                 stats[merchantId].updated++

    // Progress
    if (totalRows % 1000 === 0) process.stdout.write(`  ... ${totalRows} rows processed\n`)
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n── Summary ──────────────────────────────────────────────')
  console.log(`  Total rows processed : ${totalRows}`)

  for (const [mid, s] of Object.entries(stats)) {
    const domain = MERCHANT_DOMAINS[mid] ?? mid
    console.log(`\n  Merchant: ${domain} (${mid})`)
    console.log(`    Rows in feed   : ${s.rows}`)
    console.log(`    Comics matched : ${s.comics}`)
    console.log(`    Created        : ${s.created}`)
    console.log(`    Updated        : ${s.updated}`)
    console.log(`    Price changed  : ${s.priceChanged}`)
    console.log(`    Skipped        : ${s.skipped}`)
  }

  if (DRY) {
    console.log('\n  Run with --write to save to DB.')
  }

  // ── Post-run: verify visible product pages ────────────────────────────────
  if (WRITE) {
    const multiRetailer = await prisma.$queryRaw<[{ cnt: number }]>`
      SELECT COUNT(*)::int AS cnt FROM (
        SELECT canonical_product_id
        FROM   retailer_listings
        WHERE  price_amount > 0 AND canonical_product_id IS NOT NULL AND deleted_at IS NULL
        GROUP  BY canonical_product_id
        HAVING COUNT(DISTINCT retailer_id) >= 2
      ) sub
    `
    console.log(`\n  ✓ Products with 2+ priced retailers: ${multiRetailer[0].cnt}`)
  }

  console.log('══════════════════════════════════════════════════════════\n')
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
