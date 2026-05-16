#!/usr/bin/env tsx
/**
 * scripts/backfill-bookshop-listings.ts
 *
 * Creates Bookshop.org UK listings for all canonical products with an isbn13
 * that do not already have a Bookshop UK listing.
 *
 * With BOOKSHOP_UK_API_KEY (or BOOKSHOP_API_KEY) set:
 *   Fetches real prices from the Bookshop.org API. Rate limit: 1 req/s.
 *
 * Without API key:
 *   Creates dynamic link stubs (stockStatus=UNKNOWN, priceAmount=£0.00).
 *   Stubs are excluded from product page price tables (priceAmount > 0 filter)
 *   but provide valid affiliate redirects via /go/[id] once BOOKSHOP_AFFILIATE_ID
 *   is configured.  The daily bookshop-refresh Inngest job will promote stubs
 *   to real price listings when the API key is added.
 *
 * Usage:
 *   npm run backfill:bookshop
 *   npm run backfill:bookshop -- --market uk          (UK only, default)
 *   npm run backfill:bookshop -- --market both        (UK + US)
 *   npm run backfill:bookshop -- --batch-size 200
 *   npm run backfill:bookshop -- --dry-run
 *   npm run backfill:bookshop -- --stubs-only         (skip API even if key present)
 *
 * Env vars:
 *   DATABASE_URL              — Prisma connection string
 *   BOOKSHOP_AFFILIATE_ID     — Bookshop.org partner/affiliate ID (for /a/{id}/ URLs)
 *   BOOKSHOP_UK_AFFILIATE_ID  — UK-specific (falls back to BOOKSHOP_AFFILIATE_ID)
 *   BOOKSHOP_API_KEY          — optional; enables real price data
 *   BOOKSHOP_UK_API_KEY       — optional UK key (falls back to BOOKSHOP_API_KEY)
 */

import { prisma }       from '../lib/prisma'
import { lookupByIsbn } from '../lib/adapters/bookshop'

// ── CLI args ──────────────────────────────────────────────────────────────────

const args       = process.argv.slice(2)
const DRY_RUN    = args.includes('--dry-run')
const STUBS_ONLY = args.includes('--stubs-only')

const BATCH_SIZE = (() => {
  const idx = args.indexOf('--batch-size')
  return idx !== -1 ? parseInt(args[idx + 1] ?? '500', 10) : 500
})()

const MARKET_ARG = (() => {
  const idx = args.indexOf('--market')
  return idx !== -1 ? (args[idx + 1] ?? 'uk') : 'uk'
})()

const MARKETS_TO_RUN: Array<'us' | 'uk'> =
  MARKET_ARG === 'both' ? ['uk', 'us'] : ['uk']

// Rate-limit only when calling the API
const HAS_API_KEY = !STUBS_ONLY && !!(
  process.env.BOOKSHOP_UK_API_KEY ?? process.env.BOOKSHOP_API_KEY
)
const RATE_MS = HAS_API_KEY ? 1_000 : 50  // 1/s with API key; 50 ms DB-only

const HAS_AFFILIATE_ID = !!(
  process.env.BOOKSHOP_UK_AFFILIATE_ID ?? process.env.BOOKSHOP_AFFILIATE_ID
)

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(` Catch Comics — Bookshop.org Listing Backfill`)
  console.log(` Mode        : ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`)
  console.log(` Markets     : ${MARKETS_TO_RUN.join(', ')}`)
  console.log(` Batch size  : ${BATCH_SIZE}`)
  console.log(` API key     : ${HAS_API_KEY ? 'YES — real prices will be fetched' : 'NO — dynamic link stubs only'}`)
  console.log(` Affiliate ID: ${HAS_AFFILIATE_ID ? 'SET' : 'NOT SET — affiliate links will not earn commission!'}`)
  console.log(`${'═'.repeat(60)}\n`)

  if (!HAS_AFFILIATE_ID) {
    console.warn(
      '⚠  BOOKSHOP_AFFILIATE_ID is not set.\n' +
      '   Listings will be created but /go/[id] redirects will NOT earn commission.\n' +
      '   Set BOOKSHOP_AFFILIATE_ID in .env.local before running in production.\n'
    )
  }

  // ── Find ISBNs with no Bookshop UK listing ────────────────────────────────
  const bookshopDomains = MARKETS_TO_RUN.map(m =>
    m === 'uk' ? 'uk.bookshop.org' : 'bookshop.org'
  )

  const rows = await prisma.$queryRaw<Array<{ id: string; isbn13: string; title: string }>>`
    SELECT cp.id, cp.isbn_13 AS isbn13, cp.title
    FROM   canonical_products cp
    WHERE  cp.isbn_13 IS NOT NULL
      AND  cp.deleted_at IS NULL
      AND  NOT EXISTS (
        SELECT 1
        FROM   retailer_listings rl
        JOIN   retailers r ON r.id = rl.retailer_id
        WHERE  rl.canonical_product_id = cp.id
          AND  r.domain = ANY(${bookshopDomains}::text[])
          AND  rl.deleted_at IS NULL
      )
    ORDER  BY cp.created_at DESC
    LIMIT  ${BATCH_SIZE}
  `

  console.log(`Found ${rows.length} canonical product(s) without a Bookshop listing.\n`)

  if (rows.length === 0) {
    console.log('Nothing to do — all ISBNs already have Bookshop listings.')
    return
  }

  let processed   = 0
  let created     = 0
  let updated     = 0
  let priceChange = 0
  let errors      = 0
  let withPrice   = 0

  const startTime = Date.now()

  for (const row of rows) {
    processed++

    if (DRY_RUN) {
      console.log(`  [${processed}] ~ would upsert Bookshop listing for ${row.isbn13}: "${row.title}"`)
      created++
      continue
    }

    try {
      const results = await lookupByIsbn(row.isbn13, row.id, MARKETS_TO_RUN)

      for (const r of results) {
        if (r.outcome === 'created')       created++
        else if (r.outcome === 'updated')  updated++
        else if (r.outcome === 'price_changed') { updated++; priceChange++ }
        else if (r.outcome === 'error')    errors++

        if (r.found && r.priceAmount && parseFloat(r.priceAmount) > 0) {
          withPrice++
          console.log(
            `  [${processed}] ✓ ${r.market.toUpperCase()} ${row.isbn13}` +
            ` "${row.title.substring(0, 50)}" @ ${r.currency} ${r.priceAmount}`
          )
        } else {
          console.log(
            `  [${processed}] ~ ${r.market.toUpperCase()} ${row.isbn13}` +
            ` "${row.title.substring(0, 50)}" → stub (${r.outcome})`
          )
        }
      }
    } catch (err) {
      console.error(`  [${processed}] ✗ error for ${row.isbn13}:`, err)
      errors++
    }

    // Rate limit
    if (HAS_API_KEY) {
      await new Promise(r => setTimeout(r, RATE_MS))
    } else if (processed % 100 === 0) {
      // Small yield for DB-only mode to avoid connection pool exhaustion
      await new Promise(r => setTimeout(r, RATE_MS))
    }
  }

  const elapsed = Date.now() - startTime

  console.log(`\n${'═'.repeat(60)}`)
  console.log(` Backfill complete — ${(elapsed / 1000).toFixed(1)}s`)
  console.log(`${'═'.repeat(60)}`)
  console.log(`  Processed        : ${processed}`)
  console.log(`  Created          : ${created}`)
  console.log(`  Updated          : ${updated}  (${priceChange} price changes)`)
  console.log(`  With real price  : ${withPrice}  (remainder are stubs)`)
  console.log(`  Errors           : ${errors}`)
  if (errors > 0 && created === 0 && updated === 0) {
    console.log(`\n  ✗ Nothing created — all rows errored. Most likely cause:`)
    console.log(`    DYNAMIC_LINK enum not yet in PostgreSQL. Run:`)
    console.log(`    npm run db:migrate:deploy`)
    console.log(`    then re-run this script.`)
  } else if (!HAS_API_KEY && created > 0) {
    console.log(`\n  ℹ  ${created} dynamic link stubs created — add BOOKSHOP_API_KEY`)
    console.log(`     and run again (or wait for the daily bookshop-refresh job)`)
    console.log(`     to populate real prices.`)
  }
  console.log()
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
