#!/usr/bin/env tsx
/**
 * seed-abebooks.ts
 *
 * Registers AbeBooks (UK) as a DYNAMIC_LINK retailer and creates ISBN-based
 * presence stubs for all TM-linked canonicals with an ISBN-13.
 *
 * AbeBooks integration facts (as of 2026-05-19):
 *   - Domain         : abebooks.co.uk
 *   - Ownership      : Amazon subsidiary
 *   - Focus          : Used, rare, out-of-print books (excellent for OOP comics)
 *   - ISBN search URL: abebooks.co.uk/servlet/SearchResults?isbn={ISBN13}
 *   - Affiliate      : AWIN mid=6139 (abebooks.co.uk) — PENDING publisher approval
 *                      Set to null until AWIN publisher account is confirmed.
 *                      When approved: UPDATE retailers SET affiliate_network='AWIN',
 *                      affiliate_id='6139' WHERE domain='abebooks.co.uk'
 *   - Source type    : DYNAMIC_LINK — presence link, no commission yet
 *   - Trust score    : 72 — Amazon-owned marketplace; individual sellers vary
 *
 * Usage:
 *   npx dotenv-cli -e .env.local -- tsx scripts/seed-abebooks.ts             dry-run
 *   npx dotenv-cli -e .env.local -- tsx scripts/seed-abebooks.ts -- --write  write to DB
 */

import { prisma } from '../lib/prisma'
import { RetailerPlatform, MatchMethod, ListingCondition, StockStatus } from '@prisma/client'

const WRITE        = process.argv.includes('--write')
const URL_TEMPLATE = 'https://www.abebooks.co.uk/servlet/SearchResults?isbn={ISBN13}'

const ABEBOOKS = {
  domain          : 'abebooks.co.uk',
  name            : 'AbeBooks',
  country         : 'GB',
  currency        : 'GBP',
  trustScore      : 72,
  affiliateNetwork: null as string | null,   // AWIN pending — update to 'AWIN' when approved
  affiliateId     : null as string | null,   // AWIN mid=6139 — update when approved
  syncConfig      : {
    sourceType   : 'DYNAMIC_LINK',
    urlTemplate  : URL_TEMPLATE,
    affiliateCode: null,
    awinMid      : '6139',                   // stored for reference, not yet active
    confirmedDate: '2026-05-19',
    note         : 'AWIN mid=6139 pending publisher approval. Presence link only until approved. ' +
                   'UPDATE retailers SET affiliate_network=\'AWIN\', affiliate_id=\'6139\' when ready.',
  },
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' AbeBooks (UK) — Retailer Registration + Stub Creation')
  console.log(` Mode        : ${WRITE ? 'WRITE' : 'DRY-RUN'}`)
  console.log(` URL template: ${URL_TEMPLATE}`)
  console.log(' ⚠ AWIN affiliate pending — presence link only (no commission yet)')
  console.log('══════════════════════════════════════════════════════════\n')

  // ── Step 1: Upsert retailer record ─────────────────────────────────────────
  let retailer = await prisma.retailer.findUnique({ where: { domain: ABEBOOKS.domain } })

  if (retailer) {
    console.log(`  ✓ Retailer already exists: ${retailer.id}`)
    console.log(`    Name      : ${retailer.name}`)
    console.log(`    AffNetwork: ${retailer.affiliateNetwork ?? 'none'}`)

    if (WRITE) {
      retailer = await prisma.retailer.update({
        where: { id: retailer.id },
        data: {
          name       : ABEBOOKS.name,
          trustScore : ABEBOOKS.trustScore,
          syncConfig : ABEBOOKS.syncConfig,
          // Do NOT overwrite affiliateNetwork/affiliateId — may have been set manually
        },
      })
      console.log('  ✓ Updated AbeBooks retailer record (trustScore + syncConfig).')
    } else {
      console.log('  (dry-run) Would update existing record.')
    }
  } else {
    console.log('  Retailer not in DB. Creating...\n')
    console.log(`  Domain      : ${ABEBOOKS.domain}`)
    console.log(`  Name        : ${ABEBOOKS.name}`)
    console.log(`  Trust score : ${ABEBOOKS.trustScore}`)
    console.log(`  Affiliate   : none (pending AWIN approval, mid=6139)`)

    if (!WRITE) {
      console.log('\n  (dry-run) Pass --write to create.')
    } else {
      retailer = await prisma.retailer.create({
        data: {
          domain          : ABEBOOKS.domain,
          name            : ABEBOOKS.name,
          platform        : RetailerPlatform.DIRECT_AFFILIATE,
          countryCode     : ABEBOOKS.country,
          currency        : ABEBOOKS.currency,
          trustScore      : ABEBOOKS.trustScore,
          affiliateNetwork: null,
          affiliateId     : null,
          syncConfig      : ABEBOOKS.syncConfig,
        },
      })
      console.log(`\n  ✓ Created retailer: ${retailer.id}`)
    }
  }

  if (!WRITE) {
    // In dry-run, retailer may still be null — just report what would happen
  }

  // ── Step 2: Load TM-linked canonicals with an ISBN ─────────────────────────
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
  `

  const existingCount = retailer
    ? await prisma.retailerListing.count({
        where: { retailerId: retailer.id, deletedAt: null },
      })
    : 0

  console.log(`\n  TM-linked ISBNs  : ${canonicals.length}`)
  console.log(`  Existing stubs   : ${existingCount}`)
  console.log(`  Will create/touch: up to ${canonicals.length}`)

  // Sample URLs
  console.log('\n  Sample URLs:')
  for (const c of canonicals.slice(0, 3)) {
    console.log(`    ${URL_TEMPLATE.replace('{ISBN13}', c.isbn13)}`)
  }

  if (!WRITE || !retailer) {
    console.log(`\n  Would create/update ${canonicals.length} stubs.`)
    console.log('  Pass --write to execute.\n')
    console.log('══════════════════════════════════════════════════════════\n')
    return
  }

  // ── Step 3: Create / update stubs ──────────────────────────────────────────
  let created = 0, updated = 0, errors = 0

  for (const canon of canonicals) {
    const retailerUrl = URL_TEMPLATE.replace('{ISBN13}', encodeURIComponent(canon.isbn13))
    const retailerSku = canon.isbn13

    try {
      const existing = await prisma.retailerListing.findFirst({
        where: { retailerId: retailer!.id, retailerSku, deletedAt: null },
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
            retailerId        : retailer!.id,
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
  console.log(`\n  ✓ AbeBooks now has presence on ${created + updated} TM-linked comics.`)
  console.log('  ⚠ No commission yet — presence links only.')
  console.log('  ✦ When AWIN approved:')
  console.log("    UPDATE retailers SET affiliate_network='AWIN', affiliate_id='6139'")
  console.log("    WHERE domain='abebooks.co.uk';")
  console.log('══════════════════════════════════════════════════════════\n')
}

main().catch(console.error).finally(() => prisma.$disconnect())
