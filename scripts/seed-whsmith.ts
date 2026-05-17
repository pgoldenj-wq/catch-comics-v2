#!/usr/bin/env tsx
/**
 * seed-whsmith.ts
 *
 * Registers WHSmith as a DYNAMIC_LINK (no-commission presence) retailer in the DB.
 *
 * WHSmith integration facts (as of 2026-05-17):
 *   - Affiliate programme: None active (historic programme closed/restricted)
 *   - Cashback: TopCashback via direct agreement, not AWIN
 *   - ISBN search URL: whsmith.co.uk/search?term={ISBN13}
 *   - Source type: DYNAMIC_LINK — presence link, no commission earned
 *   - Note: direct product URLs require title slug — ISBN search is the safe pattern
 *
 * Usage:
 *   npm run seed:whsmith               dry-run
 *   npm run seed:whsmith -- --write    write to DB
 */

import { prisma } from '../lib/prisma'
import { RetailerPlatform } from '@prisma/client'

const WRITE = process.argv.includes('--write')

const URL_TEMPLATE = 'https://www.whsmith.co.uk/search?term={ISBN13}'

const WHSMITH = {
  domain          : 'whsmith.co.uk',
  name            : 'WHSmith',
  country         : 'GB',
  currency        : 'GBP',
  trustScore      : 80,   // Mainstream UK retailer, good for user trust
  affiliateNetwork: null as string | null,
  affiliateId     : null as string | null,
  syncConfig      : {
    sourceType   : 'DYNAMIC_LINK',
    urlTemplate  : URL_TEMPLATE,
    affiliateCode: null,
    confirmedDate: '2026-05-17',
    note         : 'No active affiliate programme. Presence link only (no commission). Search URL pattern.',
  },
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' WHSmith — Retailer Registration')
  console.log(` Mode        : ${WRITE ? 'WRITE' : 'DRY-RUN'}`)
  console.log(` URL template: ${URL_TEMPLATE}`)
  console.log(' ⚠ No affiliate code — presence link only (no commission)')
  console.log('══════════════════════════════════════════════════════════\n')

  const existing = await prisma.retailer.findUnique({ where: { domain: WHSMITH.domain } })

  if (existing) {
    console.log(`  ✓ Retailer already exists: ${existing.id}`)
    console.log(`    Name      : ${existing.name}`)
    console.log(`    AffNetwork: ${existing.affiliateNetwork ?? 'none'}`)
    console.log(`    SyncConfig: ${JSON.stringify(existing.syncConfig)}`)

    if (WRITE) {
      await prisma.retailer.update({
        where: { id: existing.id },
        data: {
          name       : WHSMITH.name,
          trustScore : WHSMITH.trustScore,
          syncConfig : WHSMITH.syncConfig,
        },
      })
      console.log('\n  ✓ Updated WHSmith retailer record.')
    } else {
      console.log('\n  (dry-run) Would update existing record.')
    }
    return
  }

  console.log('  Retailer not yet in DB. Creating...\n')
  console.log(`  Domain      : ${WHSMITH.domain}`)
  console.log(`  Name        : ${WHSMITH.name}`)
  console.log(`  URL template: ${URL_TEMPLATE}`)

  if (!WRITE) {
    console.log('\n  (dry-run) Pass --write to create.')
    return
  }

  const retailer = await prisma.retailer.create({
    data: {
      domain          : WHSMITH.domain,
      name            : WHSMITH.name,
      platform        : RetailerPlatform.DIRECT_AFFILIATE,
      countryCode     : WHSMITH.country,
      currency        : WHSMITH.currency,
      trustScore      : WHSMITH.trustScore,
      affiliateNetwork: null,
      affiliateId     : null,
      syncConfig      : WHSMITH.syncConfig,
    },
  })

  console.log(`\n  ✓ Created: ${retailer.id}`)
  console.log('  Next: npm run create:whsmith -- --write')
  console.log('══════════════════════════════════════════════════════════\n')
}

main().catch(console.error).finally(() => prisma.$disconnect())
