#!/usr/bin/env tsx
/**
 * seed-zavvi.ts
 *
 * Registers Zavvi as an AWIN-affiliate DYNAMIC_LINK retailer in the DB.
 *
 * Zavvi integration facts (as of 2026-05-18):
 *   - Affiliate network: AWIN, merchant ID 2549 (confirmed working)
 *   - Commission: ~5% on eligible products
 *   - Catalogue: DC, Marvel, manga, graphic novels
 *   - URL pattern: search-based (no known direct ISBN product URL pattern)
 *   - Source type: DYNAMIC_LINK — links generated from ISBN at click time
 *
 * Usage:
 *   npm run seed:zavvi               dry-run
 *   npm run seed:zavvi -- --write    write to DB
 */

import { prisma } from '../lib/prisma'
import { RetailerPlatform } from '@prisma/client'

const WRITE = process.argv.includes('--write')

const AWIN_MERCHANT_ID = '2549' // confirmed valid

// Search-based URL — no direct ISBN product URL pattern known for Zavvi.
// Verify direct product URL pattern manually and update if found.
const URL_TEMPLATE = 'https://www.zavvi.com/search?q={ISBN13}&searchType=products'

const ZAVVI_RETAILER = {
  domain           : 'zavvi.com',
  name             : 'Zavvi',
  country          : 'GB',
  currency         : 'GBP',
  trustScore       : 80,
  affiliateNetwork : 'awin',
  affiliateId      : AWIN_MERCHANT_ID,
  syncConfig       : {
    sourceType    : 'DYNAMIC_LINK',
    urlTemplate   : URL_TEMPLATE,
    awinMerchantId: AWIN_MERCHANT_ID,
    confirmedDate : '2026-05-18',
    note          : 'AWIN mid=2549 confirmed valid. Comic/manga/graphic novel catalogue. Search URL — verify direct product URL pattern manually.',
  },
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' Zavvi — Retailer Registration')
  console.log(` Mode        : ${WRITE ? 'WRITE' : 'DRY-RUN'}`)
  console.log(` URL template: ${URL_TEMPLATE}`)
  console.log('══════════════════════════════════════════════════════════\n')

  const existing = await prisma.retailer.findUnique({ where: { domain: ZAVVI_RETAILER.domain } })

  if (existing) {
    console.log(`  ✓ Retailer already exists: ${existing.id}`)
    console.log(`    Name      : ${existing.name}`)
    console.log(`    AffNetwork: ${existing.affiliateNetwork ?? 'none'}`)
    console.log(`    AffId     : ${existing.affiliateId ?? 'none'}`)
    console.log(`    SyncConfig: ${JSON.stringify(existing.syncConfig)}`)

    if (WRITE) {
      await prisma.retailer.update({
        where: { id: existing.id },
        data: {
          name            : ZAVVI_RETAILER.name,
          affiliateNetwork: ZAVVI_RETAILER.affiliateNetwork,
          affiliateId     : ZAVVI_RETAILER.affiliateId,
          trustScore      : ZAVVI_RETAILER.trustScore,
          syncConfig      : ZAVVI_RETAILER.syncConfig,
        },
      })
      console.log('\n  ✓ Updated existing Zavvi retailer record.')
    } else {
      console.log('\n  (dry-run) Would update existing record.')
    }
    return
  }

  console.log('  Retailer not yet in DB. Creating...\n')
  console.log(`  Domain      : ${ZAVVI_RETAILER.domain}`)
  console.log(`  Name        : ${ZAVVI_RETAILER.name}`)
  console.log(`  AWIN mid    : ${AWIN_MERCHANT_ID}`)
  console.log(`  URL template: ${URL_TEMPLATE}`)

  if (!WRITE) {
    console.log('\n  (dry-run) Pass --write to create.')
    return
  }

  const retailer = await prisma.retailer.create({
    data: {
      domain          : ZAVVI_RETAILER.domain,
      name            : ZAVVI_RETAILER.name,
      platform        : RetailerPlatform.DIRECT_AFFILIATE,
      countryCode     : ZAVVI_RETAILER.country,
      currency        : ZAVVI_RETAILER.currency,
      trustScore      : ZAVVI_RETAILER.trustScore,
      affiliateNetwork: ZAVVI_RETAILER.affiliateNetwork,
      affiliateId     : ZAVVI_RETAILER.affiliateId,
      syncConfig      : ZAVVI_RETAILER.syncConfig,
    },
  })

  console.log(`\n  ✓ Created: ${retailer.id}`)
  console.log('  Next: npm run create:zavvi -- --write')
  console.log('══════════════════════════════════════════════════════════\n')
}

main().catch(console.error).finally(() => prisma.$disconnect())
