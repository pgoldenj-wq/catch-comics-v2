/**
 * sync-tm-now — trigger a full Shopify resync for the Travelling Man retailer.
 * Mirrors sync-wob-now.ts — runs directly via Node without a live dev server.
 */

import { PrismaClient } from '@prisma/client'
import { ShopifyAdapter } from '../lib/adapters/shopify'

const prisma = new PrismaClient()

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
  if (retailer.platform !== 'SHOPIFY') {
    console.error(`Retailer platform is ${retailer.platform}, expected SHOPIFY.`)
    await prisma.$disconnect()
    process.exit(1)
  }

  log(`Travelling Man — id=${retailer.id} domain=${retailer.domain}`)
  log(`Last successful sync: ${retailer.lastSyncedAt?.toISOString() ?? 'never'}`)

  const syncLog = await prisma.syncLog.create({
    data: { retailerId: retailer.id, status: 'running', startedAt: new Date() },
  })
  log(`sync_log id=${syncLog.id}`)

  try {
    log('Starting Shopify adapter — this can take several minutes…')
    const adapter = new ShopifyAdapter()
    const result  = await adapter.syncRetailer(retailer.id)

    const durMin = ((Date.now() - startMs) / 60000).toFixed(1)
    log(`Done in ${durMin} min`)
    log(`  productsFetched : ${result.productsFetched}`)
    log(`  listingsCreated : ${result.listingsCreated}`)
    log(`  listingsUpdated : ${result.listingsUpdated}`)
    log(`  priceChanges    : ${result.priceChanges}`)
    log(`  errors          : ${result.errors.length}`)
    if (result.errors.length > 0) {
      log('First 5 errors:')
      result.errors.slice(0, 5).forEach((e, i) =>
        log(`    ${i + 1}. [${e.type}] ${e.message}`)
      )
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
    log('sync_log finalised — exiting clean.')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log(`FAILED: ${message}`)
    await prisma.syncLog.update({
      where: { id: syncLog.id },
      data: {
        status      : 'error',
        finishedAt  : new Date(),
        errorCount  : 1,
        errorSummary: message,
      },
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
