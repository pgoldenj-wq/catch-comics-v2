/**
 * Confirms ShopifyAdapter.syncRetailer rejects non-SHOPIFY retailers.
 * Tests the hard guard added to prevent FP (DIRECT_AFFILIATE) being synced
 * through the Shopify path.
 */
import { ShopifyAdapter } from '../lib/adapters/shopify'
import { prisma } from '../lib/prisma'

async function main() {
  const adapter = new ShopifyAdapter()

  // ── Test 1: DIRECT_AFFILIATE retailer (Forbidden Planet) ──────────────────
  const fp = await prisma.retailer.findUnique({ where: { domain: 'forbiddenplanet.com' } })
  if (!fp) {
    console.error('❌  Forbidden Planet retailer not found in DB — run migrations first')
    return
  }

  console.log(`\nFP retailer: platform=${fp.platform}, is_active=${fp.isActive}`)
  console.log('Calling syncRetailer(fp.id) — should throw immediately...')

  try {
    await adapter.syncRetailer(fp.id)
    console.log('❌  ERROR: guard did NOT fire — this is a bug')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('SHOPIFY')) {
      console.log(`✅  Guard fired correctly:\n    ${msg}`)
    } else {
      console.log(`⚠️  Threw but unexpected message:\n    ${msg}`)
    }
  }

  // ── Test 2: eBay retailer (also not SHOPIFY, different platform) ──────────
  const ebayUk = await prisma.retailer.findUnique({ where: { domain: 'ebay.co.uk' } })
  if (ebayUk) {
    console.log(`\neBay UK retailer: platform=${ebayUk.platform}`)
    console.log('Calling syncRetailer(ebayUk.id) — should also throw...')
    try {
      await adapter.syncRetailer(ebayUk.id)
      console.log('❌  ERROR: guard did NOT fire — this is a bug')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('SHOPIFY')) {
        console.log(`✅  Guard fired correctly for EBAY platform too:\n    ${msg}`)
      } else {
        console.log(`⚠️  Threw but unexpected message:\n    ${msg}`)
      }
    }
  }

  await prisma.$disconnect()
}

main().catch(err => { console.error(err); process.exit(1) })
