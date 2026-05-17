#!/usr/bin/env tsx
/**
 * seed-hive.ts
 *
 * Registers Hive as a DYNAMIC_LINK retailer in the DB.
 *
 * Hive integration facts (as of 2026-05-17):
 *   - Affiliate network: Webgains, programme ID 10671
 *   - Commission: 4-8% tiered
 *   - Website: hive.co.uk (UK indie bookshop aggregator, 762K product feed available)
 *   - Source type: DYNAMIC_LINK — links generated from ISBN at click time
 *   - URL pattern: hive.co.uk/Product/Details/{ISBN13}
 *   - Bot access blocked (403 on all headless requests) — URL pattern unverifiable via fetch
 *   - Approval pending with Webgains
 *
 * Usage:
 *   npm run seed:hive               dry-run
 *   npm run seed:hive -- --write    write to DB
 */

import { prisma } from '../lib/prisma'
import { RetailerPlatform } from '@prisma/client'

const WRITE = process.argv.includes('--write')

// ── Hive config ───────────────────────────────────────────────────────────────

// Canonical ISBN-addressable product URL on Hive.
// Note: hive.co.uk returns 403 to headless fetchers so this could not be
// live-verified. Pattern is the standard Hive product URL documented via
// Webgains programme materials.
const URL_TEMPLATE = 'https://www.hive.co.uk/Product/Details/{ISBN13}'

const HIVE_RETAILER = {
  domain           : 'hive.co.uk',
  name             : 'Hive',
  country          : 'GB',
  currency         : 'GBP',
  trustScore       : 88,   // Strong UK indie bookshop aggregator, good for user trust
  affiliateNetwork : 'webgains',
  affiliateId      : '10671',
  // syncConfig stores the URL template for DYNAMIC_LINK generation
  syncConfig       : {
    sourceType      : 'DYNAMIC_LINK',
    urlTemplate     : URL_TEMPLATE,
    webgainsProgramId: '10671',
    confirmedDate   : '2026-05-17',
    note            : 'Webgains programme ID 10671. 4-8% tiered commission. 762K product feed available. Approval pending.',
  },
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' Hive — Retailer Registration')
  console.log(` Mode: ${WRITE ? 'WRITE' : 'DRY-RUN'}`)
  console.log('══════════════════════════════════════════════════════════\n')

  const existing = await prisma.retailer.findUnique({ where: { domain: HIVE_RETAILER.domain } })

  if (existing) {
    console.log(`  ✓ Retailer already exists: ${existing.id}`)
    console.log(`    Name        : ${existing.name}`)
    console.log(`    AffNetwork  : ${existing.affiliateNetwork ?? 'none'}`)
    console.log(`    AffId       : ${existing.affiliateId ?? 'none'}`)
    console.log(`    SyncConfig  : ${JSON.stringify(existing.syncConfig)}`)

    if (WRITE) {
      await prisma.retailer.update({
        where: { id: existing.id },
        data: {
          name             : HIVE_RETAILER.name,
          affiliateNetwork : HIVE_RETAILER.affiliateNetwork,
          affiliateId      : HIVE_RETAILER.affiliateId,
          trustScore       : HIVE_RETAILER.trustScore,
          syncConfig       : HIVE_RETAILER.syncConfig,
        },
      })
      console.log('\n  ✓ Updated existing Hive retailer record.')
    } else {
      console.log('\n  (dry-run) Would update existing record.')
    }
    return
  }

  console.log('  Retailer not yet in DB. Creating...\n')
  console.log(`  Domain       : ${HIVE_RETAILER.domain}`)
  console.log(`  Name         : ${HIVE_RETAILER.name}`)
  console.log(`  AffNetwork   : ${HIVE_RETAILER.affiliateNetwork}`)
  console.log(`  AffId        : ${HIVE_RETAILER.affiliateId}`)
  console.log(`  URL template : ${URL_TEMPLATE}`)

  if (!WRITE) {
    console.log('\n  (dry-run) Pass --write to create.')
    return
  }

  const retailer = await prisma.retailer.create({
    data: {
      domain           : HIVE_RETAILER.domain,
      name             : HIVE_RETAILER.name,
      platform         : RetailerPlatform.DIRECT_AFFILIATE,
      countryCode      : HIVE_RETAILER.country,
      currency         : HIVE_RETAILER.currency,
      trustScore       : HIVE_RETAILER.trustScore,
      affiliateNetwork : HIVE_RETAILER.affiliateNetwork,
      affiliateId      : HIVE_RETAILER.affiliateId,
      syncConfig       : HIVE_RETAILER.syncConfig,
    },
  })

  console.log(`\n  ✓ Created: ${retailer.id}`)
  console.log(`  Next: run create:hive -- --write to generate ISBN listings`)
  console.log('══════════════════════════════════════════════════════════\n')
}

main().catch(console.error).finally(() => prisma.$disconnect())
