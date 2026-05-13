#!/usr/bin/env tsx
import { prisma } from '../lib/prisma'

const SUSPECTS = ['9780099416449', '9780143570837']

async function main() {
  for (const isbn of SUSPECTS) {
    const rows = await prisma.metadataCache.findMany({
      where: { isbn13: isbn },
    })
    console.log(`\nISBN ${isbn}:`)
    for (const r of rows) {
      const d = r.data as { result: Record<string, unknown> | null }
      if (!d.result) { console.log(`  [${r.source}] null (not found)`); continue }
      const res = d.result
      console.log(`  [${r.source}]`)
      console.log(`    title     : ${res.title}`)
      console.log(`    subtitle  : ${res.subtitle}`)
      console.log(`    publisher : ${res.publisher}`)
      console.log(`    desc      : ${String(res.description ?? '').slice(0, 120)}`)
    }
  }
}
main().catch(console.error).finally(() => prisma.$disconnect())
