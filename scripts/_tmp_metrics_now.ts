import { prisma } from '../lib/prisma'
async function main() {
  const [tmWordery, tmAny, worderyPriced, tmLinkedUnpriced] = await Promise.all([
    prisma.$queryRaw<[{cnt:number}]>`SELECT COUNT(DISTINCT cp.id)::int AS cnt FROM canonical_products cp WHERE cp.deleted_at IS NULL AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id WHERE r.domain='travellingman.com' AND rl.canonical_product_id=cp.id AND rl.price_amount>0 AND rl.deleted_at IS NULL) AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id WHERE r.domain='wordery.com' AND rl.canonical_product_id=cp.id AND rl.price_amount>0 AND rl.deleted_at IS NULL)`,
    prisma.$queryRaw<[{cnt:number}]>`SELECT COUNT(DISTINCT cp.id)::int AS cnt FROM canonical_products cp WHERE cp.deleted_at IS NULL AND EXISTS (SELECT 1 FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id WHERE r.domain='travellingman.com' AND rl.canonical_product_id=cp.id AND rl.price_amount>0 AND rl.deleted_at IS NULL) AND (SELECT COUNT(DISTINCT rl2.retailer_id) FROM retailer_listings rl2 WHERE rl2.canonical_product_id=cp.id AND rl2.price_amount>0 AND rl2.deleted_at IS NULL) >= 2`,
    prisma.retailerListing.count({ where: { retailer: { domain: 'wordery.com' }, priceAmount: { gt: 0 }, deletedAt: null } }),
    prisma.$queryRaw<[{cnt:number}]>`SELECT COUNT(*)::int AS cnt FROM retailer_listings rl JOIN retailers r ON r.id=rl.retailer_id WHERE r.domain='wordery.com' AND rl.deleted_at IS NULL AND rl.price_amount<=0 AND rl.isbn_13 IS NOT NULL AND EXISTS (SELECT 1 FROM retailer_listings tm JOIN retailers tmr ON tmr.id=tm.retailer_id WHERE tmr.domain='travellingman.com' AND tm.canonical_product_id=rl.canonical_product_id AND tm.deleted_at IS NULL AND tm.price_amount>0)`,
  ])
  console.log(`TM+Wordery pages : ${tmWordery[0].cnt}`)
  console.log(`TM+any pages     : ${tmAny[0].cnt}`)
  console.log(`Wordery priced   : ${worderyPriced}`)
  console.log(`TM-linked unpric : ${tmLinkedUnpriced[0].cnt}`)
}
main().catch(console.error).finally(() => prisma.$disconnect())
