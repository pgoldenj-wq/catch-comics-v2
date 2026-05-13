#!/usr/bin/env tsx
// One-off: enable comic_filter on Travelling Man's sync_config
import { prisma } from '../lib/prisma'

async function main() {
  const TM_ID = 'bb626f10-abd7-47a7-8848-bf69833cc902'
  const retailer = await prisma.retailer.findUniqueOrThrow({ where: { id: TM_ID } })
  const current = (retailer.syncConfig ?? {}) as Record<string, unknown>

  if (current.comic_filter === true) {
    console.log('comic_filter already true — nothing to do')
    return
  }

  await prisma.retailer.update({
    where: { id: TM_ID },
    data:  { syncConfig: { ...current, comic_filter: true } },
  })
  console.log('✓ comic_filter=true set on Travelling Man')
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
