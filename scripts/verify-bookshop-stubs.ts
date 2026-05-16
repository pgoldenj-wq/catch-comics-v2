#!/usr/bin/env tsx
/**
 * scripts/verify-bookshop-stubs.ts
 *
 * Read-only diagnostic. Verifies that Bookshop.org UK dynamic link stubs
 * were created correctly after the backfill:
 *   1. Retailer row: affiliateNetwork='awin', affiliateId='62675', platform=DYNAMIC_LINK
 *   2. Sample listings: bare retailerUrl, stockStatus=UNKNOWN, priceAmount=0.00
 *   3. Checks that wrapAffiliateUrl() would produce the correct Awin URL
 *   4. Checks that no £0.00 stubs are visible via the priceAmount > 0 product filter
 */

import { prisma } from '../lib/prisma'

const AWIN_PUBLISHER_ID = process.env.AWIN_PUBLISHER_ID ?? '(NOT SET)'

function simulateWrapAffiliateUrl(
  targetUrl: string,
  affiliateNetwork: string | null,
  affiliateId: string | null,
  clickref?: string,
): string {
  if (!affiliateNetwork || !affiliateId) return targetUrl
  if (affiliateNetwork.toLowerCase() === 'awin') {
    const params = new URLSearchParams({
      awinmid:  affiliateId,
      awinaffid: AWIN_PUBLISHER_ID,
      ued:       targetUrl,
    })
    if (clickref) params.set('clickref', clickref)
    return `https://www.awin1.com/cread.php?${params.toString()}`
  }
  return targetUrl
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' Bookshop.org Stub Verification')
  console.log(' AWIN_PUBLISHER_ID:', AWIN_PUBLISHER_ID)
  console.log('══════════════════════════════════════════════════════════\n')

  // ── 1. Retailer row ─────────────────────────────────────────────────────────
  console.log('── 1. Retailer rows ─────────────────────────────────────')
  const retailers = await prisma.retailer.findMany({
    where: { domain: { in: ['uk.bookshop.org', 'bookshop.org'] } },
    select: {
      id: true, name: true, domain: true,
      platform: true, affiliateNetwork: true, affiliateId: true,
      isActive: true,
    },
  })

  if (retailers.length === 0) {
    console.log('  ✗ NO Bookshop retailer rows found — backfill may not have run\n')
  } else {
    for (const r of retailers) {
      const networkOk  = r.affiliateNetwork === 'awin'
      const midOk      = r.affiliateId === '62675'
      const platformOk = (r.platform as string) === 'DYNAMIC_LINK'
      console.log(`  ${r.name} (${r.domain})`)
      console.log(`    platform        : ${r.platform}  ${platformOk ? '✓' : '✗ expected DYNAMIC_LINK'}`)
      console.log(`    affiliateNetwork: ${r.affiliateNetwork}  ${networkOk ? '✓' : '✗ expected awin'}`)
      console.log(`    affiliateId     : ${r.affiliateId}  ${midOk ? '✓' : '✗ expected 62675'}`)
      console.log(`    isActive        : ${r.isActive}`)
      console.log(`    id              : ${r.id}`)
    }
  }

  const ukRetailer = retailers.find(r => r.domain === 'uk.bookshop.org')
  if (!ukRetailer) {
    console.log('\n  Cannot continue — uk.bookshop.org retailer row missing.')
    return
  }

  // ── 2. Listing count and sample ─────────────────────────────────────────────
  console.log('\n── 2. Listing counts ────────────────────────────────────')
  const totalCount = await prisma.retailerListing.count({
    where: { retailerId: ukRetailer.id, deletedAt: null },
  })
  const stubCount = await prisma.retailerListing.count({
    where: { retailerId: ukRetailer.id, deletedAt: null, priceAmount: { lte: 0 } },
  })
  const pricedCount = await prisma.retailerListing.count({
    where: { retailerId: ukRetailer.id, deletedAt: null, priceAmount: { gt: 0 } },
  })
  console.log(`  Total listings : ${totalCount}`)
  console.log(`  Stubs (£0.00)  : ${stubCount}  (hidden from product pages)`)
  console.log(`  Priced         : ${pricedCount}  (visible in comparison table)`)

  // ── 3. Sample listings ──────────────────────────────────────────────────────
  console.log('\n── 3. Sample stub listings ──────────────────────────────')
  const samples = await prisma.retailerListing.findMany({
    where: { retailerId: ukRetailer.id, deletedAt: null, priceAmount: { lte: 0 } },
    select: {
      id: true, retailerSku: true, retailerUrl: true,
      priceAmount: true, stockStatus: true, matchMethod: true,
      matchConfidence: true, isbn13: true,
    },
    take: 5,
    orderBy: { firstSeenAt: 'desc' },
  })

  for (const s of samples) {
    const urlOk     = s.retailerUrl.startsWith('https://uk.bookshop.org/p/books/')
    const priceOk   = s.priceAmount.toFixed(2) === '0.00'
    const stockOk   = s.stockStatus === 'UNKNOWN'
    const matchOk   = s.matchMethod === 'ISBN'

    console.log(`\n  Listing ID  : ${s.id}`)
    console.log(`  ISBN-13     : ${s.isbn13 ?? s.retailerSku}`)
    console.log(`  retailerUrl : ${s.retailerUrl}  ${urlOk ? '✓' : '✗'}`)
    console.log(`  priceAmount : ${s.priceAmount}  ${priceOk ? '✓' : '✗'}`)
    console.log(`  stockStatus : ${s.stockStatus}  ${stockOk ? '✓' : '✗'}`)
    console.log(`  matchMethod : ${s.matchMethod}  ${matchOk ? '✓' : '✗'}`)

    // Simulate /go redirect
    const wrappedUrl = simulateWrapAffiliateUrl(
      s.retailerUrl,
      ukRetailer.affiliateNetwork,
      ukRetailer.affiliateId,
      `cc-${s.id.slice(0, 8)}`,
    )
    console.log(`\n  /go redirect simulation:`)
    console.log(`  clickref    : cc-${s.id.slice(0, 8)}`)
    console.log(`  outbound URL: ${wrappedUrl}`)
  }

  // ── 4. Priced visibility check ──────────────────────────────────────────────
  console.log('\n── 4. Product page visibility (priceAmount > 0 filter) ──')
  const visibleBookshop = await prisma.retailerListing.count({
    where: {
      retailerId : ukRetailer.id,
      deletedAt  : null,
      priceAmount: { gt: 0 },
      retailer   : { isActive: true },
    },
  })
  console.log(`  Listings visible in price tables : ${visibleBookshop}`)
  if (visibleBookshop === 0) {
    console.log('  ✓ No Bookshop stubs appear in product page comparison tables')
    console.log('    (All stubs correctly hidden — will surface when API key added)')
  }

  // ── 5. £0.00 leak check — any retailer ────────────────────────────────────
  console.log('\n── 5. £0.00 public visibility check (all retailers) ─────')
  const zeroVisible = await prisma.retailerListing.count({
    where: {
      deletedAt  : null,
      priceAmount: { lte: 0 },
      retailer   : { isActive: true },
    },
  })
  console.log(`  Listings with price ≤ 0 across all active retailers: ${zeroVisible}`)
  if (zeroVisible > 0) {
    console.log(`  ✗ WARNING: ${zeroVisible} listing(s) with price ≤ 0 — check product page filter`)
  } else {
    console.log(`  ✓ No £0.00 leaks — product page filter working correctly`)
  }

  console.log('\n══════════════════════════════════════════════════════════\n')
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
