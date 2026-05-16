#!/usr/bin/env tsx
/**
 * One-shot: patch existing Bookshop UK stubs whose retailer_url incorrectly
 * uses /p/books/{isbn} — returns 404 — replacing with /book/{isbn} which
 * issues a 308 redirect to the canonical Bookshop product page.
 *
 * Safe to run multiple times (idempotent — WHERE LIKE '%/p/books/%' means
 * already-patched rows are not matched again).
 */

import { prisma } from '../lib/prisma'

async function main() {
  const patched = await prisma.$executeRaw`
    UPDATE retailer_listings rl
    SET    retailer_url = REPLACE(retailer_url, '/p/books/', '/book/')
    FROM   retailers r
    WHERE  rl.retailer_id = r.id
      AND  r.domain       = 'uk.bookshop.org'
      AND  rl.retailer_url LIKE '%/p/books/%'
      AND  rl.deleted_at IS NULL
  `
  console.log(`Patched ${patched} Bookshop UK listing URL(s): /p/books/ → /book/`)
}

main()
  .catch(err => { console.error('Fatal:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
