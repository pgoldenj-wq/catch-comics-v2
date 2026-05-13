#!/usr/bin/env tsx
import { prisma } from '../lib/prisma'
async function main() {
  const rows = await prisma.canonicalProduct.findMany({
    where: { isbn13: { in: ['9780099416449','9780143570837'] } },
    select: { isbn13: true, title: true, publisher: true, format: true, description: true },
  })
  for (const r of rows) {
    console.log(`\n${r.isbn13} | "${r.title}"`)
    console.log(`  publisher : ${r.publisher}`)
    console.log(`  format    : ${r.format}`)
    console.log(`  desc      : ${(r.description ?? '').slice(0, 150)}`)
  }
}
main().catch(console.error).finally(() => prisma.$disconnect())
