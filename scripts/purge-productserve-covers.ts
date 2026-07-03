#!/usr/bin/env tsx
/**
 * purge-productserve-covers.ts — B1 (war-room backlog, 2026-07-03)
 *
 * AWIN datafeed syncs seeded cover_image_url with proxy thumbnails
 * (images2.productserve.com — 200×200 white-letterboxed retailer thumbs).
 * These are not covers: they violate the Cover Zero policy, and any host
 * outside next/image remotePatterns crash-classed product pages in dev.
 * The writer is fixed (sync-awin-feed.ts now seeds NULL); this script
 * cleans the rows already written.
 *
 * Usage:
 *   npx dotenv -e .env.local -- tsx scripts/purge-productserve-covers.ts             dry-run (default)
 *   npx dotenv -e .env.local -- tsx scripts/purge-productserve-covers.ts --execute   null productserve covers
 *
 * Dry-run reports: productserve count, full host breakdown of every
 * non-allowlisted cover host (report-only), and sample rows.
 */

import { prisma } from '../lib/prisma'

const EXECUTE = process.argv.includes('--execute')

// Hosts that are legitimate cover sources (R2 + validated externals).
// Anything else in cover_image_url is suspect and gets reported.
const ALLOWED_HOST_FRAGMENTS = [
  'images.catchcomics.com',
  'r2.dev',
  'comicvine.gamespot.com',
  'covers.openlibrary.org',
  'books.google.com',
  'images-eu.bookshop.org',
]

async function main() {
  // ── 1. Quantify productserve pollution ─────────────────────────────────────
  const psRows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM canonical_products
    WHERE deleted_at IS NULL AND cover_image_url ILIKE '%productserve%'`
  const psCount = Number(psRows[0].n)

  const psLive = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM canonical_products cp
    WHERE cp.deleted_at IS NULL AND cp.cover_image_url ILIKE '%productserve%'
      AND EXISTS (SELECT 1 FROM retailer_listings l
                  WHERE l.canonical_product_id = cp.id AND l.deleted_at IS NULL)`

  console.log(`productserve cover URLs on live canonicals : ${psCount.toLocaleString()}`)
  console.log(`  …of which have live listings             : ${Number(psLive[0].n).toLocaleString()}`)

  // ── 2. Host breakdown of all non-allowlisted cover hosts (report only) ─────
  const hosts = await prisma.$queryRaw<{ host: string; n: bigint }[]>`
    SELECT substring(cover_image_url from '^https?://([^/]+)') AS host, COUNT(*) AS n
    FROM canonical_products
    WHERE deleted_at IS NULL AND cover_image_url IS NOT NULL
    GROUP BY 1 ORDER BY 2 DESC`

  console.log('\nCover host breakdown (non-allowlisted flagged ⚠):')
  for (const h of hosts) {
    const ok = h.host && ALLOWED_HOST_FRAGMENTS.some(f => h.host.includes(f))
    console.log(`  ${ok ? '  ' : '⚠ '}${h.host ?? '(unparseable)'}  ${Number(h.n).toLocaleString()}`)
  }

  // ── 3. Samples ──────────────────────────────────────────────────────────────
  const samples = await prisma.canonicalProduct.findMany({
    where: { deletedAt: null, coverImageUrl: { contains: 'productserve', mode: 'insensitive' } },
    select: { title: true, canonicalSlug: true, comicvineId: true },
    take: 5,
  })
  console.log('\nSample affected products:')
  for (const s of samples) console.log(`  ${s.title}  (${s.canonicalSlug})  cvId=${s.comicvineId ?? '—'}`)

  // ── 4. Execute ──────────────────────────────────────────────────────────────
  if (!EXECUTE) {
    console.log('\nDRY RUN — nothing written. Re-run with --execute to null these covers.')
    return
  }

  const res = await prisma.$executeRaw`
    UPDATE canonical_products
    SET cover_image_url = NULL, updated_at = NOW()
    WHERE deleted_at IS NULL AND cover_image_url ILIKE '%productserve%'`
  console.log(`\nEXECUTED — nulled ${res} productserve cover URLs.`)

  const remaining = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM canonical_products
    WHERE deleted_at IS NULL AND cover_image_url ILIKE '%productserve%'`
  console.log(`Remaining productserve covers: ${Number(remaining[0].n)}`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
