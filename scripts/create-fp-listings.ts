#!/usr/bin/env tsx
/**
 * create-fp-listings.ts
 *
 * Creates DYNAMIC_LINK retailer_listings for Forbidden Planet.
 *
 * Strategy:
 *   For every canonical product that Travelling Man stocks (confirmed comic),
 *   create a Forbidden Planet listing pointing to the FP ISBN search URL.
 *   This gets FP onto comparison pages immediately, without a product feed.
 *
 *   Prices are set to 0 initially (unknown). The /go/ redirect resolves the
 *   affiliate URL at click time. Optionally: after creating stubs, run
 *   enrich-fp-prices.ts to fetch real prices via Playwright (future).
 *
 *   Affiliate link format: confirmed once dashboard investigation completes.
 *   Currently using: forbiddenplanet.com/search/?q={ISBN13}&ref=catchcomics
 *   UPDATE the URL_TEMPLATE constant once the real affiliate param is confirmed.
 *
 * Usage:
 *   npm run create:fp:listings                dry-run (show counts)
 *   npm run create:fp:listings -- --write     create stubs in DB
 *   npm run create:fp:listings -- --limit 500 --write
 */

import { prisma } from '../lib/prisma'
import { MatchMethod, ListingCondition, StockStatus } from '@prisma/client'

const args   = process.argv.slice(2)
const WRITE  = args.includes('--write')
const limIdx = args.indexOf('--limit')
const LIMIT  = limIdx !== -1 ? parseInt(args[limIdx + 1] ?? '99999', 10) : 99_999

// ── Affiliate link format — CONFIRMED 2026-05-17 ─────────────────────────────
// Affiliate param: ?affid=catchcomics (query parameter, not redirect-based)
// Source: live FP affiliate guide + examples in index showing ?affid=gnative pattern
// ISBN search route: /catalog/?q={ISBN}&affid=catchcomics
// Known product route: /forbiddenplanet.com/{numeric-id}-{slug}/?affid=catchcomics
// Using catalog search as the canonical route until we have numeric IDs mapped.
const URL_TEMPLATE = (isbn13: string) =>
  `https://forbiddenplanet.com/catalog/?q=${encodeURIComponent(isbn13)}&affid=catchcomics`

async function main() {
  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' Forbidden Planet — Create DYNAMIC_LINK Stubs')
  console.log(` Mode  : ${WRITE ? 'WRITE' : 'DRY-RUN'}`)
  console.log(` Limit : ${LIMIT === 99_999 ? 'unlimited' : LIMIT}`)
  console.log('══════════════════════════════════════════════════════════\n')

  // Check FP retailer exists
  const fpRetailer = await prisma.retailer.findUnique({ where: { domain: 'forbiddenplanet.com' } })
  if (!fpRetailer) {
    console.error('  ✗ Forbidden Planet retailer not found in DB.')
    console.error('    Run: npm run seed:fp -- --write first.')
    process.exit(1)
  }
  console.log(`  FP retailer ID: ${fpRetailer.id}`)

  // All TM-linked canonical products with an ISBN (confirmed comics)
  const canonicals = await prisma.$queryRaw<Array<{ id: string; isbn13: string; title: string }>>`
    SELECT DISTINCT cp.id, cp.isbn_13 AS isbn13, cp.title
    FROM canonical_products cp
    JOIN retailer_listings rl ON rl.canonical_product_id = cp.id
    JOIN retailers r ON r.id = rl.retailer_id
    WHERE r.domain = 'travellingman.com'
      AND rl.price_amount > 0
      AND rl.deleted_at IS NULL
      AND cp.deleted_at IS NULL
      AND cp.isbn_13 IS NOT NULL
    ORDER BY cp.title ASC
    LIMIT ${LIMIT}
  `

  console.log(`  TM-linked canonicals with ISBN: ${canonicals.length}`)

  // Count existing FP listings
  const existingCount = await prisma.retailerListing.count({
    where: { retailerId: fpRetailer.id, deletedAt: null },
  })
  console.log(`  Existing FP listings         : ${existingCount}`)

  const toCreate = canonicals.filter(async () => true)  // all, upsert handles dupes
  console.log(`  Stubs to upsert             : ${toCreate.length}\n`)

  if (!WRITE) {
    console.log('  Sample (first 5):')
    for (const c of canonicals.slice(0, 5)) {
      console.log(`    ${c.isbn13}  ${c.title.slice(0, 50)}`)
      console.log(`      → ${URL_TEMPLATE(c.isbn13)}`)
    }
    console.log('\n  Pass --write to create stubs.')
    console.log('══════════════════════════════════════════════════════════\n')
    return
  }

  let created = 0
  let updated = 0
  let errors  = 0

  for (const canon of canonicals) {
    const retailerUrl = URL_TEMPLATE(canon.isbn13)
    const retailerSku = canon.isbn13  // ISBN as SKU for DYNAMIC_LINK

    try {
      const existing = await prisma.retailerListing.findFirst({
        where: { retailerId: fpRetailer.id, retailerSku, deletedAt: null },
        select: { id: true },
      })

      if (existing) {
        // Update URL in case template changed
        await prisma.retailerListing.update({
          where: { id: existing.id },
          data: { retailerUrl, lastSeenAt: new Date() },
        })
        updated++
      } else {
        await prisma.retailerListing.create({
          data: {
            retailerId        : fpRetailer.id,
            canonicalProductId: canon.id,
            isbn13            : canon.isbn13,
            retailerSku,
            retailerUrl,
            title             : canon.title,
            priceAmount       : '0.00',   // unknown — DYNAMIC_LINK, price at click time
            priceCurrency     : 'GBP',
            stockStatus       : StockStatus.UNKNOWN,
            condition         : ListingCondition.NEW,
            matchMethod       : MatchMethod.ISBN,
            firstSeenAt       : new Date(),
            lastSeenAt        : new Date(),
          },
        })
        created++
      }

      if ((created + updated) % 100 === 0) {
        process.stdout.write(`  Progress: ${created} created, ${updated} updated, ${errors} errors\r`)
      }
    } catch (err) {
      errors++
      console.error(`  [error] ${canon.isbn13}: ${(err as Error).message}`)
    }
  }

  process.stdout.write('\n')
  console.log('\n── Summary ──────────────────────────────────────────────')
  console.log(`  Created : ${created}`)
  console.log(`  Updated : ${updated}`)
  console.log(`  Errors  : ${errors}`)
  console.log(`\n  ✓ FP is now on comparison pages for ${created + updated} TM-linked comics.`)
  console.log(`    Run npm run dashboard to see updated page counts.`)
  console.log(`\n  ⚠ IMPORTANT: Verify affiliate link format from FP dashboard`)
  console.log(`    then update URL_TEMPLATE in this script and re-run to fix URLs.`)
  console.log('══════════════════════════════════════════════════════════\n')
}

main().catch(console.error).finally(() => prisma.$disconnect())
