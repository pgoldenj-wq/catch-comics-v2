#!/usr/bin/env tsx
/**
 * scripts/backfill-wordery-listings.ts
 *
 * Creates Wordery dynamic-link stub listings for all canonical products with
 * an isbn13 that do not already have a Wordery listing.
 *
 * Stubs have:
 *   stockStatus = UNKNOWN, priceAmount = £0.00
 * They are hidden from the product page price-comparison table (priceAmount > 0
 * filter) but provide valid affiliate redirects via /go/[id] → Awin wrapping:
 *   https://www.awin1.com/cread.php?awinmid=9111&awinaffid=2888331&clickref=cc-{id}&ued=https://wordery.com/{isbn13}
 *
 * Usage:
 *   npm run backfill:wordery
 *   npm run backfill:wordery -- --batch-size 5000
 *   npm run backfill:wordery -- --dry-run
 *
 * Env vars:
 *   DATABASE_URL     — Prisma connection string (loaded by dotenv-cli)
 *   AWIN_PUBLISHER_ID — required for live affiliate links (set globally)
 */

import { prisma }                  from '../lib/prisma'
import { backfillWorderyListings, generateWorderyUrl } from '../lib/adapters/wordery'

// ── CLI args ──────────────────────────────────────────────────────────────────

const args       = process.argv.slice(2)
const DRY_RUN    = args.includes('--dry-run')
const BATCH_SIZE = (() => {
  const idx = args.indexOf('--batch-size')
  return idx !== -1 ? parseInt(args[idx + 1] ?? '2000', 10) : 2000
})()

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(` Catch Comics — Wordery Listing Backfill`)
  console.log(` Mode       : ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`)
  console.log(` Batch size : ${BATCH_SIZE}`)
  console.log(` AWIN MID   : 9111`)
  console.log(` URL pattern: https://wordery.com/{isbn13}`)
  console.log(`${'═'.repeat(60)}\n`)

  if (DRY_RUN) {
    const count = await prisma.$queryRaw<[{ n: bigint }]>`
      SELECT COUNT(*) AS n
      FROM   canonical_products cp
      WHERE  cp.isbn_13  IS NOT NULL
        AND  cp.deleted_at IS NULL
        AND  NOT EXISTS (
          SELECT 1 FROM retailer_listings rl
          JOIN   retailers r ON r.id = rl.retailer_id
          WHERE  rl.canonical_product_id = cp.id
            AND  r.domain = 'wordery.com'
            AND  rl.deleted_at IS NULL
        )
    `
    const eligible = Number(count[0].n)
    const sample   = generateWorderyUrl('9781779527226')
    console.log(`  Would create : ${eligible} Wordery stubs`)
    console.log(`  Sample URL   : ${sample}`)
    console.log(`  Affiliate    : https://www.awin1.com/cread.php?awinmid=9111&awinaffid=${process.env.AWIN_PUBLISHER_ID ?? '(NOT SET)'}&ued=${encodeURIComponent(sample)}`)
    console.log()
    return
  }

  const startTime = Date.now()
  const stats     = await backfillWorderyListings(BATCH_SIZE)
  const elapsed   = Date.now() - startTime

  console.log(`\n${'═'.repeat(60)}`)
  console.log(` Backfill complete — ${(elapsed / 1000).toFixed(1)}s`)
  console.log(`${'═'.repeat(60)}`)
  console.log(`  Processed : ${stats.processed}`)
  console.log(`  Created   : ${stats.created}`)
  console.log(`  Updated   : ${stats.updated}`)
  console.log(`  Errors    : ${stats.errors}`)

  if (stats.errors > 0 && stats.created === 0) {
    console.log(`\n  ✗ Nothing created — check errors above.`)
    console.log(`    Common cause: DYNAMIC_LINK enum missing. Run: npm run db:migrate:deploy`)
  } else if (stats.created > 0) {
    console.log(`\n  ✓ ${stats.created} Wordery stubs ready for affiliate redirects.`)
    console.log(`    Visible in price table once pricing is added.`)
    console.log(`    Run verify: npx dotenv-cli -e .env.local -- npx tsx scripts/verify-bookshop-stubs.ts`)
  }
  console.log()
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
