#!/usr/bin/env tsx
/**
 * seed-waterstones.ts
 *
 * Registers Waterstones as an AWIN-affiliate DYNAMIC_LINK retailer in the DB.
 *
 * Waterstones integration facts (as of 2026-05-17):
 *   - Affiliate network: AWIN, merchant ID 2079
 *   - Commission: 2-5% on books
 *   - ISBN-direct URL: waterstones.com/book/{ISBN13} → resolves to product page
 *   - Affiliate wrapper: awin1.com/cread.php?awinmid=2079&awinaffid=2888331&ued={encodedUrl}
 *   - Source type: DYNAMIC_LINK — links generated from ISBN at click time
 *
 * Usage:
 *   npm run seed:waterstones               dry-run
 *   npm run seed:waterstones -- --write    write to DB
 */

import { prisma } from '../lib/prisma'
import { RetailerPlatform } from '@prisma/client'

const WRITE = process.argv.includes('--write')

const AWIN_PUBLISHER_ID = '2888331'
const AWIN_MERCHANT_ID  = '2079'

// AWIN deep-link wrapper around the ISBN-direct Waterstones product URL
const URL_TEMPLATE =
  `https://www.awin1.com/cread.php?awinmid=${AWIN_MERCHANT_ID}&awinaffid=${AWIN_PUBLISHER_ID}&ued=` +
  encodeURIComponent('https://www.waterstones.com/book/') + '{ISBN13}'

const WATERSTONES = {
  domain           : 'waterstones.com',
  name             : 'Waterstones',
  country          : 'GB',
  currency         : 'GBP',
  trustScore       : 90,   // High — UK's largest specialist bookseller
  affiliateNetwork : 'awin',
  affiliateId      : AWIN_MERCHANT_ID,
  syncConfig       : {
    sourceType    : 'DYNAMIC_LINK',
    urlTemplate   : URL_TEMPLATE,
    awinMerchantId: AWIN_MERCHANT_ID,
    awinPublisherId: AWIN_PUBLISHER_ID,
    confirmedDate : '2026-05-17',
    note          : 'AWIN merchant 2079. ISBN-direct URL: /book/{ISBN13}. 2-5% commission.',
  },
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' Waterstones — Retailer Registration')
  console.log(` Mode        : ${WRITE ? 'WRITE' : 'DRY-RUN'}`)
  console.log(` URL template: ${URL_TEMPLATE.slice(0, 80)}...`)
  console.log('══════════════════════════════════════════════════════════\n')

  const existing = await prisma.retailer.findUnique({ where: { domain: WATERSTONES.domain } })

  if (existing) {
    console.log(`  ✓ Retailer already exists: ${existing.id}`)
    console.log(`    Name      : ${existing.name}`)
    console.log(`    AffNetwork: ${existing.affiliateNetwork ?? 'none'}`)
    console.log(`    SyncConfig: ${JSON.stringify(existing.syncConfig)}`)

    if (WRITE) {
      await prisma.retailer.update({
        where: { id: existing.id },
        data: {
          name            : WATERSTONES.name,
          affiliateNetwork: WATERSTONES.affiliateNetwork,
          affiliateId     : WATERSTONES.affiliateId,
          trustScore      : WATERSTONES.trustScore,
          syncConfig      : WATERSTONES.syncConfig,
        },
      })
      console.log('\n  ✓ Updated Waterstones retailer record.')
    } else {
      console.log('\n  (dry-run) Would update existing record.')
    }
    return
  }

  console.log('  Retailer not yet in DB. Creating...\n')
  console.log(`  Domain      : ${WATERSTONES.domain}`)
  console.log(`  Name        : ${WATERSTONES.name}`)
  console.log(`  AWIN mid    : ${AWIN_MERCHANT_ID}`)
  console.log(`  URL template: ${URL_TEMPLATE.slice(0, 80)}...`)

  if (!WRITE) {
    console.log('\n  (dry-run) Pass --write to create.')
    return
  }

  const retailer = await prisma.retailer.create({
    data: {
      domain          : WATERSTONES.domain,
      name            : WATERSTONES.name,
      platform        : RetailerPlatform.DIRECT_AFFILIATE,
      countryCode     : WATERSTONES.country,
      currency        : WATERSTONES.currency,
      trustScore      : WATERSTONES.trustScore,
      affiliateNetwork: WATERSTONES.affiliateNetwork,
      affiliateId     : WATERSTONES.affiliateId,
      syncConfig      : WATERSTONES.syncConfig,
    },
  })

  console.log(`\n  ✓ Created: ${retailer.id}`)
  console.log('  Next: npm run create:waterstones -- --write')
  console.log('══════════════════════════════════════════════════════════\n')
}

main().catch(console.error).finally(() => prisma.$disconnect())
