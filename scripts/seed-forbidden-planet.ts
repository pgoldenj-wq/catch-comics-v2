#!/usr/bin/env tsx
/**
 * seed-forbidden-planet.ts
 *
 * Registers Forbidden Planet as a DYNAMIC_LINK retailer in the DB.
 *
 * FP integration facts (as of 2026-05-17):
 *   - Affiliate code: catchcomics (direct programme, 10% commission)
 *   - Website: forbiddenplanet.com (UK), forbiddenplanet.com (US via .com)
 *   - Source type: DYNAMIC_LINK — links generated from ISBN at click time
 *   - No public product feed (403 on all bot requests)
 *   - Affiliate link format TBD — update AFFILIATE_URL_TEMPLATE once confirmed
 *   - ISBN search URL: forbiddenplanet.com/search/?q={ISBN}
 *
 * Usage:
 *   npm run seed:fp               dry-run
 *   npm run seed:fp -- --write    write to DB
 */

import { prisma } from '../lib/prisma'
import { RetailerPlatform } from '@prisma/client'

const WRITE = process.argv.includes('--write')

// ── Forbidden Planet config ───────────────────────────────────────────────────

// Update this once affiliate link format is confirmed from the dashboard.
// Typical formats: /?ref=CODE appended to any URL, or /affiliates/go/?code=CODE&url=TARGET
// Current best guess: append ?ref=catchcomics to any forbiddenplanet.com URL
const AFFILIATE_CODE     = 'catchcomics'
// Confirmed 2026-05-17: FP affiliate param is ?affid= (not ?ref=, ?aff=, etc.)
// Source: live affiliate guide showing ?affid=gnative in example URLs
const AFFILIATE_TEMPLATE = 'https://forbiddenplanet.com/catalog/?q={ISBN13}&affid=catchcomics'

const FP_RETAILER = {
  domain           : 'forbiddenplanet.com',
  name             : 'Forbidden Planet',
  country          : 'GB',
  currency         : 'GBP',
  trustScore       : 85,   // High — specialist comic retailer, reliable prices
  affiliateNetwork : 'direct',
  affiliateId      : AFFILIATE_CODE,
  // syncConfig stores the URL template for DYNAMIC_LINK generation
  syncConfig       : {
    sourceType   : 'DYNAMIC_LINK',
    urlTemplate  : AFFILIATE_TEMPLATE,
    affiliateCode: AFFILIATE_CODE,
    affiliateParam: 'affid',
    confirmedDate : '2026-05-17',
    note          : 'Direct affiliate programme. 10% commission. No product feed — DYNAMIC_LINK only.',
  },
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' Forbidden Planet — Retailer Registration')
  console.log(` Mode: ${WRITE ? 'WRITE' : 'DRY-RUN'}`)
  console.log('══════════════════════════════════════════════════════════\n')

  const existing = await prisma.retailer.findUnique({ where: { domain: FP_RETAILER.domain } })

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
          name             : FP_RETAILER.name,
          affiliateNetwork : FP_RETAILER.affiliateNetwork,
          affiliateId      : FP_RETAILER.affiliateId,
          trustScore       : FP_RETAILER.trustScore,
          syncConfig       : FP_RETAILER.syncConfig,
        },
      })
      console.log('\n  ✓ Updated existing FP retailer record.')
    } else {
      console.log('\n  (dry-run) Would update existing record.')
    }
    return
  }

  console.log('  Retailer not yet in DB. Creating...\n')
  console.log(`  Domain       : ${FP_RETAILER.domain}`)
  console.log(`  Name         : ${FP_RETAILER.name}`)
  console.log(`  AffCode      : ${FP_RETAILER.affiliateId}`)
  console.log(`  URL template : ${AFFILIATE_TEMPLATE}`)

  if (!WRITE) {
    console.log('\n  (dry-run) Pass --write to create.')
    return
  }

  const retailer = await prisma.retailer.create({
    data: {
      domain           : FP_RETAILER.domain,
      name             : FP_RETAILER.name,
      platform         : RetailerPlatform.DIRECT_AFFILIATE,
      countryCode      : FP_RETAILER.country,
      currency         : FP_RETAILER.currency,
      trustScore       : FP_RETAILER.trustScore,
      affiliateNetwork : FP_RETAILER.affiliateNetwork,
      affiliateId      : FP_RETAILER.affiliateId,
      syncConfig       : FP_RETAILER.syncConfig,
    },
  })

  console.log(`\n  ✓ Created: ${retailer.id}`)
  console.log(`  Next: run seed:fp:listings -- --write to create ISBN stubs`)
  console.log('══════════════════════════════════════════════════════════\n')
}

main().catch(console.error).finally(() => prisma.$disconnect())
