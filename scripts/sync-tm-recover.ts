/**
 * sync-tm-recover.ts — one complete, no-create Travelling Man catalogue pass.
 *
 * Purpose: repair the stock state corrupted on 2026-08-18, when a deliberate
 * 5-page run over a ~90-page catalogue treated the pages it never fetched as
 * missing inventory and flipped 1,361 listings to OUT_OF_STOCK.
 *
 * The repair is not a bulk UPDATE. The retailer is the source of truth: this
 * walks the whole catalogue, and every product Travelling Man still lists comes
 * back IN_STOCK through the normal upsert path. Listings genuinely gone stay
 * gone, and only reach OUT_OF_STOCK via the unchanged two-consecutive-complete-
 * syncs rule.
 *
 * Safety:
 *   • --no-create   nothing may be added to the catalogue during a repair
 *   • hard page ceiling; refuses to reconcile unless traversal proved complete
 *   • direct CLI — zero Inngest executions, no scheduler, no replay
 *   • reports before/after stock state and asserts zero product creations
 *
 * Usage:
 *   npx dotenv -e .env.local -- npx tsx scripts/sync-tm-recover.ts --dry-run
 *   npx dotenv -e .env.local -- npx tsx scripts/sync-tm-recover.ts --write
 */

import { PrismaClient } from '@prisma/client'
import { ShopifyAdapter } from '../lib/adapters/shopify'

const prisma = new PrismaClient()

const argv     = process.argv.slice(2)
const WRITE    = argv.includes('--write')
const capIdx   = argv.indexOf('--max-pages')
const MAX_PAGES = capIdx !== -1 ? parseInt(argv[capIdx + 1] ?? '150', 10) : 150

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`)

async function snapshot(retailerId: string) {
  const [total, inStock, oos, unknown, priced, products] = await Promise.all([
    prisma.retailerListing.count({ where: { retailerId, deletedAt: null } }),
    prisma.retailerListing.count({ where: { retailerId, deletedAt: null, stockStatus: 'IN_STOCK' } }),
    prisma.retailerListing.count({ where: { retailerId, deletedAt: null, stockStatus: 'OUT_OF_STOCK' } }),
    prisma.retailerListing.count({ where: { retailerId, deletedAt: null, stockStatus: 'UNKNOWN' } }),
    prisma.retailerListing.count({ where: { retailerId, deletedAt: null, priceAmount: { gt: 0 }, canonicalProductId: { not: null } } }),
    prisma.canonicalProduct.count(),
  ])
  return { total, inStock, oos, unknown, priced, products }
}

async function main() {
  const retailer = await prisma.retailer.findFirst({ where: { domain: 'travellingman.com' } })
  if (!retailer) { console.error('Travelling Man not found'); process.exit(1) }

  const cfg = (retailer.syncConfig ?? {}) as Record<string, unknown>
  const prevMissing = (cfg.prev_missing_skus as string[] | undefined)?.length ?? 0

  log(`Travelling Man — ${retailer.domain}`)
  log(`maxPages=${MAX_PAGES} · allowCreate=false · mode=${WRITE ? 'WRITE' : 'DRY-RUN'}`)
  log(`prev_missing_skus currently holds ${prevMissing.toLocaleString()} SKUs`)

  const before = await snapshot(retailer.id)
  log(`BEFORE  listings ${before.total.toLocaleString()} · IN_STOCK ${before.inStock.toLocaleString()} · OUT_OF_STOCK ${before.oos.toLocaleString()} · UNKNOWN ${before.unknown} · visible priced ${before.priced.toLocaleString()}`)
  log(`BEFORE  canonical products in catalogue: ${before.products.toLocaleString()}`)

  if (!WRITE) {
    log('DRY-RUN: stopping before any network or DB write. Re-run with --write.')
    await prisma.$disconnect()
    return
  }

  const syncLog = await prisma.syncLog.create({
    data: { retailerId: retailer.id, status: 'running', startedAt: new Date() },
  })

  const adapter = new ShopifyAdapter()
  const result  = await adapter.syncRetailer(retailer.id, MAX_PAGES, { allowCreate: false })

  const after = await snapshot(retailer.id)

  log('')
  log(`pagesFetched      : ${result.pagesFetched}`)
  log(`productsFetched   : ${result.productsFetched.toLocaleString()}`)
  log(`traversalComplete : ${result.traversalComplete}`)
  log(`listingsCreated   : ${result.listingsCreated}`)
  log(`listingsUpdated   : ${result.listingsUpdated.toLocaleString()}`)
  log(`priceChanges      : ${result.priceChanges}`)
  log(`errors            : ${result.errors.length}`)
  log('')
  log(`AFTER   listings ${after.total.toLocaleString()} · IN_STOCK ${after.inStock.toLocaleString()} · OUT_OF_STOCK ${after.oos.toLocaleString()} · UNKNOWN ${after.unknown} · visible priced ${after.priced.toLocaleString()}`)
  log(`AFTER   canonical products in catalogue: ${after.products.toLocaleString()}`)
  log('')
  log(`stock repaired    : ${(after.inStock - before.inStock).toLocaleString()} listings returned to IN_STOCK`)
  log(`products created  : ${after.products - before.products}  (MUST be 0)`)

  if (!result.traversalComplete) {
    log('')
    log('⚠ TRAVERSAL DID NOT COMPLETE — absence reconciliation was skipped by design.')
    log('  The catalogue may exceed the page ceiling, or the store errored. Nothing')
    log('  was marked out of stock and prev_missing_skus was left untouched.')
  }
  if (after.products !== before.products) {
    log('')
    log(`✗ PRODUCT COUNT CHANGED by ${after.products - before.products} — no-create mode did not hold. Investigate.`)
  }

  await prisma.syncLog.update({
    where: { id: syncLog.id },
    data: {
      status: result.errors.length ? 'partial' : 'success',
      finishedAt: new Date(),
      listingsCreated: result.listingsCreated,
      listingsUpdated: result.listingsUpdated,
    },
  }).catch(() => { /* syncLog shape varies; not worth failing the run over */ })

  await prisma.$disconnect()
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
