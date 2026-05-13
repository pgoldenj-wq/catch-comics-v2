#!/usr/bin/env tsx
// One-shot: remove known false-positive canonical products
import { prisma } from '../lib/prisma'

const FP_ISBNS = ['9780099416449', '9780143570837']

async function main() {
  for (const isbn of FP_ISBNS) {
    const cp = await prisma.canonicalProduct.findFirst({ where: { isbn13: isbn }, select: { id: true, title: true } })
    if (!cp) { console.log(`${isbn}: not found, skipping`); continue }
    await prisma.$executeRaw`UPDATE retailer_listings SET canonical_product_id = NULL WHERE canonical_product_id = ${cp.id}::uuid`
    await prisma.canonicalProduct.delete({ where: { id: cp.id } })
    console.log(`Deleted "${cp.title}" (${isbn})`)
  }
}
main().catch(console.error).finally(() => prisma.$disconnect())
