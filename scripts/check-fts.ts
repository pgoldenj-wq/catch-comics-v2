#!/usr/bin/env tsx
import { prisma } from '../lib/prisma'

async function main() {
  // 1. Check pg_trgm extension
  const ext = await prisma.$queryRaw<Array<{ extname: string }>>`
    SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'
  `
  console.log('pg_trgm extension:', ext.length > 0 ? '✓ installed' : '✗ MISSING')

  // 2. Check FTS/trgm indexes
  const indexes = await prisma.$queryRaw<Array<{ indexname: string; tablename: string }>>`
    SELECT indexname, tablename
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND (
        indexname LIKE '%fts%'
        OR indexname LIKE '%trgm%'
        OR indexname = 'idx_retailer_listings_unmatched'
      )
    ORDER BY tablename, indexname
  `
  console.log('\nFTS/trgm indexes:')
  if (indexes.length === 0) {
    console.log('  ✗ NONE FOUND')
  } else {
    for (const idx of indexes) {
      console.log(`  ✓ ${idx.tablename}.${idx.indexname}`)
    }
  }

  // 3. Check API key present (without printing it)
  const hasKey = !!process.env.GOOGLE_BOOKS_API_KEY
  console.log('\nGOOGLE_BOOKS_API_KEY:', hasKey ? '✓ present' : '✗ MISSING')

  // 4. Quick count check
  const [cpCount, rlCount] = await Promise.all([
    prisma.canonicalProduct.count(),
    prisma.retailerListing.count(),
  ])
  console.log('\nDB state:')
  console.log('  canonical_products:', cpCount)
  console.log('  retailer_listings: ', rlCount)
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
