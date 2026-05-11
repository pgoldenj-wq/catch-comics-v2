#!/usr/bin/env tsx
/**
 * scripts/seed-first-retailer.ts
 *
 * One-shot: probe a domain, create a retailer row, run a full sync.
 * Safe to re-run — skips creation if domain already exists, still syncs.
 *
 * Usage:
 *   npm run seed:retailer -- --domain worldofbooks.com
 *   npm run seed:retailer -- --domain worldofbooks.com --name "World of Books" --currency GBP --country GB
 *   npm run seed:retailer -- --domain worldofbooks.com --no-sync    (create row only)
 *   npm run seed:retailer -- --domain worldofbooks.com --inngest    (fire Inngest event instead of direct sync)
 */

import { prisma }        from '../lib/prisma'
import { detectPlatform } from '../lib/adapters/platform_auto_detect'
import { dispatchSync }  from '../lib/sync/dispatch'
import { inngest }       from '../lib/inngest/client'

// ── CLI args ──────────────────────────────────────────────────────────────────

const args     = process.argv.slice(2)
const flag     = (f: string) => args.includes(f)
const flagVal  = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null }

const DOMAIN   = flagVal('--domain')
const NAME     = flagVal('--name')
const CURRENCY = flagVal('--currency') ?? 'GBP'
const COUNTRY  = flagVal('--country')  ?? 'GB'
const NO_SYNC  = flag('--no-sync')
const USE_INNGEST = flag('--inngest')

if (!DOMAIN) {
  console.error('Usage: npm run seed:retailer -- --domain <domain>')
  console.error('  e.g. npm run seed:retailer -- --domain worldofbooks.com')
  process.exit(1)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${'═'.repeat(60)}`)
  console.log(` Catch Comics — Seed First Retailer`)
  console.log(` Domain  : ${DOMAIN}`)
  console.log(` Currency: ${CURRENCY}  Country: ${COUNTRY}`)
  console.log(` Sync    : ${NO_SYNC ? 'skipped' : USE_INNGEST ? 'Inngest event' : 'direct (runs now)'}`)
  console.log(`${'═'.repeat(60)}\n`)

  // ── 1. Check for existing retailer ────────────────────────────────────────
  let retailer = await prisma.retailer.findUnique({ where: { domain: DOMAIN! } })

  if (retailer) {
    console.log(`[found] Retailer "${retailer.name}" (${DOMAIN}) already exists`)
    console.log(`  id       : ${retailer.id}`)
    console.log(`  platform : ${retailer.platform}`)
    console.log(`  isActive : ${retailer.isActive}`)
    if (!retailer.isActive) {
      console.log(`  ⚠ Retailer is inactive — activating...`)
      retailer = await prisma.retailer.update({
        where: { id: retailer.id },
        data:  { isActive: true },
      })
    }
  } else {
    // ── 2. Platform detection ───────────────────────────────────────────────
    console.log(`[probe] Detecting platform for ${DOMAIN}...`)
    const detected = await detectPlatform(DOMAIN!)

    if (!detected.platform) {
      console.error(`[fail] Could not detect a supported platform at ${DOMAIN}`)
      console.error(`       Try: worldofbooks.com (confirmed Shopify, UK books/comics)`)
      process.exit(1)
    }

    console.log(`[probe] ✓ ${detected.platform} — ${detected.sample}`)

    // ── 3. Create retailer row ──────────────────────────────────────────────
    const retailerName = NAME ?? domainToName(DOMAIN!)
    retailer = await prisma.retailer.create({
      data: {
        name       : retailerName,
        domain     : DOMAIN!,
        platform   : detected.platform,
        countryCode: COUNTRY,
        currency   : CURRENCY,
        isActive   : true,
        trustScore : 80,
        syncConfig : {},
      },
    })
    console.log(`[create] ✓ Retailer created: "${retailer.name}" id=${retailer.id}`)
  }

  if (NO_SYNC) {
    console.log(`\n[sync] Skipped (--no-sync). Retailer id: ${retailer.id}`)
    return
  }

  // ── 4a. Inngest event (background, needs dev server) ─────────────────────
  if (USE_INNGEST) {
    try {
      await inngest.send({ name: 'sync/retailer', data: { retailerId: retailer.id } })
      console.log(`\n[sync] ✓ Inngest "sync/retailer" event sent — check http://localhost:8288`)
    } catch (err) {
      console.error(`[sync] ✗ Inngest send failed:`, err instanceof Error ? err.message : err)
      console.error(`  Make sure "npm run dev" and "npm run dev:inngest" are both running.`)
    }
    return
  }

  // ── 4b. Direct sync (runs synchronously in this process) ─────────────────
  console.log(`\n[sync] Starting direct sync for ${DOMAIN}...`)
  console.log(`  This may take several minutes for large catalogs.\n`)

  const result = await dispatchSync(retailer.id)

  console.log(`\n${'═'.repeat(60)}`)
  console.log(` Sync complete — ${(result.durationMs / 1000).toFixed(1)}s`)
  console.log(`${'═'.repeat(60)}`)
  console.log(`  Pages fetched    : ${result.pagesFetched}`)
  console.log(`  Products fetched : ${result.productsFetched}`)
  console.log(`  Listings created : ${result.listingsCreated}`)
  console.log(`  Listings updated : ${result.listingsUpdated}`)
  console.log(`  Price changes    : ${result.priceChanges}`)
  console.log(`  Errors           : ${result.errors.length}`)
  if (result.errors.length > 0) {
    for (const e of result.errors.slice(0, 5)) {
      console.log(`    [${e.type}] ${e.message}${e.context ? ' — ' + e.context : ''}`)
    }
    if (result.errors.length > 5) console.log(`    ... and ${result.errors.length - 5} more`)
  }

  // ── 5. Verify: sample canonical products created ──────────────────────────
  const cpCount   = await prisma.canonicalProduct.count()
  const rlCount   = await prisma.retailerListing.count({ where: { retailerId: retailer.id } })
  const matched   = await prisma.retailerListing.count({
    where: { retailerId: retailer.id, canonicalProductId: { not: null } },
  })
  const sample    = await prisma.canonicalProduct.findMany({
    where:   { listings: { some: { retailerId: retailer.id } } },
    select:  { title: true, canonicalSlug: true, format: true },
    take:    5,
    orderBy: { createdAt: 'desc' },
  })

  console.log(`\n  DB state after sync:`)
  console.log(`    canonical_products total : ${cpCount}`)
  console.log(`    retailer_listings total  : ${rlCount}  (matched: ${matched})`)
  console.log(`\n  Sample product pages now available:`)
  for (const p of sample) {
    console.log(`    /product/${p.canonicalSlug}  [${p.format}] "${p.title}"`)
  }
  console.log()
}

/** "worldofbooks.com" → "World Of Books" */
function domainToName(domain: string): string {
  return domain
    .replace(/\.(com|co\.uk|net|org|store|shop)$/i, '')
    .split(/[\.\-]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
