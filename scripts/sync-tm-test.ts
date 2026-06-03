/**
 * sync-tm-test — controlled 5-page TM sync to verify adapter recovery.
 * 5 pages × 250 products = up to 1,250 products, ~12s between-page delay.
 * Same code path as sync-tm-now.ts but capped at 5 pages.
 */
import { PrismaClient } from '@prisma/client'
import { ShopifyAdapter } from '../lib/adapters/shopify'

const prisma = new PrismaClient()
const MAX_TEST_PAGES = 5

async function main() {
  const startMs = Date.now()
  const stamp   = () => new Date().toISOString()
  const log     = (msg: string) => console.log(`[${stamp()}] ${msg}`)

  const retailer = await prisma.retailer.findFirst({
    where: { domain: 'travellingman.com' },
  })
  if (!retailer) {
    console.error('Travelling Man retailer not found in DB.')
    await prisma.$disconnect()
    process.exit(1)
  }

  log(`Travelling Man — id=${retailer.id} domain=${retailer.domain}`)
  log(`isActive: ${retailer.isActive}`)
  log(`Last successful sync: ${retailer.lastSyncedAt?.toISOString() ?? 'never'}`)
  log(`Running CONTROLLED TEST: maxPages=${MAX_TEST_PAGES}`)

  const syncLog = await prisma.syncLog.create({
    data: { retailerId: retailer.id, status: 'running', startedAt: new Date() },
  })
  log(`sync_log id=${syncLog.id}`)

  try {
    const adapter = new ShopifyAdapter()
    const result  = await adapter.syncRetailer(retailer.id, MAX_TEST_PAGES)

    const durMin = ((Date.now() - startMs) / 60000).toFixed(1)
    log(`Done in ${durMin} min`)
    log(`  pagesFetched    : ${result.pagesFetched}`)
    log(`  productsFetched : ${result.productsFetched}`)
    log(`  listingsCreated : ${result.listingsCreated}`)
    log(`  listingsUpdated : ${result.listingsUpdated}`)
    log(`  priceChanges    : ${result.priceChanges}`)
    log(`  errors          : ${result.errors.length}`)
    if (result.errors.length > 0) {
      result.errors.forEach((e, i) => log(`    ${i + 1}. [${e.type}] ${e.message}`))
    }

    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status:          result.errors.length > 0 ? 'error' : 'success',
        finishedAt:      new Date(),
        productsFetched: result.productsFetched,
        listingsCreated: result.listingsCreated,
        listingsUpdated: result.listingsUpdated,
        priceChanges:    result.priceChanges,
        errorCount:      result.errors.length,
        errorSummary:    result.errors.length > 0
          ? result.errors.slice(0, 5).map(e => `[${e.type}] ${e.message}`).join('\n')
          : null,
      },
    })
    log(`sync_log finalised — status=${result.errors.length > 0 ? 'error' : 'success'}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log(`FAILED: ${message}`)
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: { status: 'error', finishedAt: new Date(), errorCount: 1, errorSummary: message },
    })
    await prisma.$disconnect()
    process.exit(1)
  }

  await prisma.$disconnect()
}

main().catch(async e => {
  console.error('Unhandled:', e)
  await prisma.$disconnect()
  process.exit(1)
})
