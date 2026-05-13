#!/usr/bin/env tsx
// Fetch a real in-stock listing ID for manual /go/ testing
import { prisma } from '../lib/prisma'
async function main() {
  const listing = await prisma.retailerListing.findFirst({
    where:   { stockStatus: 'IN_STOCK', canonicalProductId: { not: null } },
    orderBy: { lastSeenAt: 'desc' },
    select:  {
      id: true, retailerUrl: true, priceAmount: true, priceCurrency: true,
      retailer: { select: { name: true, affiliateNetwork: true } },
      canonicalProduct: { select: { title: true, canonicalSlug: true } },
    },
  })
  if (!listing) { console.log('No in-stock matched listings found'); return }
  console.log('\n── Test listing ─────────────────────────────────────')
  console.log('  Listing ID   :', listing.id)
  console.log('  Product      :', listing.canonicalProduct?.title)
  console.log('  Slug         :', listing.canonicalProduct?.canonicalSlug)
  console.log('  Retailer     :', listing.retailer.name, '(affiliate:', listing.retailer.affiliateNetwork ?? 'none', ')')
  console.log('  Price        :', listing.priceCurrency, Number(listing.priceAmount).toFixed(2))
  console.log('  Retailer URL :', listing.retailerUrl)
  console.log('\n── Manual test URLs ─────────────────────────────────')
  console.log('  Product page : http://localhost:3000/product/' + listing.canonicalProduct?.canonicalSlug)
  console.log('  Direct /go/  : http://localhost:3000/go/' + listing.id)
  console.log('  Invalid UUID : http://localhost:3000/go/00000000-0000-0000-0000-000000000000')
  console.log('  Bad format   : http://localhost:3000/go/not-a-uuid')
  console.log('\n── Verify click inserted ────────────────────────────')
  console.log(`  SELECT * FROM click_events WHERE listing_id = '${listing.id}' ORDER BY clicked_at DESC LIMIT 1;`)
  console.log()
}
main().catch(console.error).finally(() => prisma.$disconnect())
