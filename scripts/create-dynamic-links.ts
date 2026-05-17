#!/usr/bin/env tsx
/**
 * create-dynamic-links.ts — Universal DYNAMIC_LINK retailer stub creator
 *
 * Creates ISBN-based DYNAMIC_LINK stubs for any retailer with a stable
 * ISBN URL pattern. No product feed required.
 *
 * Strategy:
 *   For every TM-linked canonical with an ISBN, create one listing pointing
 *   to the retailer's ISBN search/product URL. Users click → retailer page.
 *   Affiliate tracking is included if --affid is supplied.
 *
 * Usage:
 *   npm run create:dynamic -- --domain waterstones.com --url-template "https://www.waterstones.com/books/search/term/{ISBN13}"
 *   npm run create:dynamic -- --domain blackwells.co.uk  --url-template "https://blackwells.co.uk/bookshop/product/{ISBN13}"
 *   npm run create:dynamic -- --domain waterstones.com  --url-template "https://www.waterstones.com/books/search/term/{ISBN13}" --affid "XXX" --aff-param "awc"
 *   Add --write to persist. Default is dry-run.
 *
 * Retailer name is auto-resolved from the domain DB record (must exist).
 * Run seed-retailer.ts first if the retailer isn't in the DB yet.
 */

import { prisma } from '../lib/prisma'
import { MatchMethod, ListingCondition, StockStatus } from '@prisma/client'

// ── CLI args ──────────────────────────────────────────────────────────────────
const args      = process.argv.slice(2)
const WRITE     = args.includes('--write')
const limIdx    = args.indexOf('--limit')
const LIMIT     = limIdx  !== -1 ? parseInt(args[limIdx  + 1] ?? '99999', 10) : 99_999
const domIdx    = args.indexOf('--domain')
const DOMAIN    = domIdx  !== -1 ? args[domIdx  + 1] : null
const urlIdx    = args.indexOf('--url-template')
const URL_TMPL  = urlIdx  !== -1 ? args[urlIdx  + 1] : null
const affIdx    = args.indexOf('--affid')
const AFF_ID    = affIdx  !== -1 ? args[affIdx  + 1] : null
const affPIdx   = args.indexOf('--aff-param')
const AFF_PARAM = affPIdx !== -1 ? args[affPIdx + 1] : 'affid'

if (!DOMAIN || !URL_TMPL) {
  console.error('\nUsage: npm run create:dynamic -- --domain DOMAIN --url-template "URL_WITH_{ISBN13}" [--write] [--limit N] [--affid CODE] [--aff-param PARAM]')
  console.error('\nExamples:')
  console.error('  npm run create:dynamic -- --domain waterstones.com \\')
  console.error('    --url-template "https://www.waterstones.com/books/search/term/{ISBN13}" --write')
  console.error('  npm run create:dynamic -- --domain blackwells.co.uk \\')
  console.error('    --url-template "https://blackwells.co.uk/bookshop/product/{ISBN13}" --write')
  process.exit(1)
}

function buildUrl(isbn13: string): string {
  let url = URL_TMPL!.replace('{ISBN13}', encodeURIComponent(isbn13))
  if (AFF_ID) {
    const sep = url.includes('?') ? '&' : '?'
    url += `${sep}${AFF_PARAM}=${encodeURIComponent(AFF_ID)}`
  }
  return url
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' Universal DYNAMIC_LINK Creator')
  console.log(` Domain      : ${DOMAIN}`)
  console.log(` URL template: ${URL_TMPL}`)
  console.log(` Affiliate   : ${AFF_ID ? `${AFF_PARAM}=${AFF_ID}` : 'none (no-commission presence link)'}`)
  console.log(` Mode        : ${WRITE ? 'WRITE' : 'DRY-RUN'}`)
  console.log(` Limit       : ${LIMIT === 99_999 ? 'unlimited' : LIMIT}`)
  console.log('══════════════════════════════════════════════════════════\n')

  const retailer = await prisma.retailer.findUnique({ where: { domain: DOMAIN! } })
  if (!retailer) {
    console.error(`  ✗ Retailer '${DOMAIN}' not found in DB.`)
    console.error('    Run: npx dotenv-cli -e .env.local -- tsx scripts/seed-retailer.ts first.')
    console.error('    Or use seed-forbidden-planet.ts as a template.')
    process.exit(1)
  }

  console.log(`  Retailer: ${retailer.name} (${retailer.id})`)

  const existingCount = await prisma.retailerListing.count({
    where: { retailerId: retailer.id, deletedAt: null },
  })

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

  console.log(`  TM-linked ISBNs available  : ${canonicals.length}`)
  console.log(`  Existing ${DOMAIN} listings: ${existingCount}`)

  // Sample URLs
  console.log('\n  Sample URLs:')
  for (const c of canonicals.slice(0, 3)) {
    console.log(`    ${buildUrl(c.isbn13).slice(0, 90)}`)
  }

  if (!WRITE) {
    console.log(`\n  Would create ~${canonicals.length - existingCount} new stubs.`)
    console.log('  Pass --write to create.\n')
    return
  }

  let created = 0, updated = 0, errors = 0

  for (const canon of canonicals) {
    const retailerUrl = buildUrl(canon.isbn13)
    const retailerSku = canon.isbn13

    try {
      const existing = await prisma.retailerListing.findFirst({
        where: { retailerId: retailer.id, retailerSku, deletedAt: null },
        select: { id: true },
      })

      if (existing) {
        await prisma.retailerListing.update({
          where: { id: existing.id },
          data: { retailerUrl, lastSeenAt: new Date() },
        })
        updated++
      } else {
        await prisma.retailerListing.create({
          data: {
            retailerId        : retailer.id,
            canonicalProductId: canon.id,
            isbn13            : canon.isbn13,
            retailerSku,
            retailerUrl,
            title             : canon.title,
            priceAmount       : '0.00',
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

      if ((created + updated) % 500 === 0 && (created + updated) > 0) {
        process.stdout.write(`  Progress: ${created} created, ${updated} updated\r`)
      }
    } catch (err) {
      errors++
      if (errors <= 3) console.error(`  [error] ${canon.isbn13}: ${(err as Error).message}`)
    }
  }

  process.stdout.write('\n')
  console.log('\n── Summary ──────────────────────────────────────────────')
  console.log(`  Created : ${created}`)
  console.log(`  Updated : ${updated}`)
  console.log(`  Errors  : ${errors}`)
  console.log(`\n  ✓ ${retailer.name} now has presence on ${created + updated} TM-linked comics.`)
  if (!AFF_ID) {
    console.log('  ⚠ No affiliate code — these are presence links only (no commission).')
    console.log('    Add --affid CODE --aff-param PARAM when affiliate is approved.')
  }
  console.log('══════════════════════════════════════════════════════════\n')
}

main().catch(console.error).finally(() => prisma.$disconnect())
