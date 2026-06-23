/** READ-ONLY: quantify recoverable covers by source availability + launch priority. */
import { prisma } from '../lib/prisma'
import { SERIES_REGISTRY } from '../lib/series/registry'

const n = (v: unknown) => Number(v as bigint)

async function main() {
  const live = await prisma.canonicalProduct.count({ where: { deletedAt: null } })
  const withCover = await prisma.canonicalProduct.count({ where: { deletedAt: null, coverImageUrl: { not: null } } })
  const nullCover = live - withCover
  console.log('═══ COVER RECOVERY AUDIT ═══')
  console.log(`Live products      : ${live.toLocaleString()}`)
  console.log(`With real cover    : ${withCover.toLocaleString()} (${(withCover/live*100).toFixed(1)}%)`)
  console.log(`MISSING cover      : ${nullCover.toLocaleString()} (${(nullCover/live*100).toFixed(1)}%)`)

  // Source availability among null-cover products
  const [src] = await prisma.$queryRawUnsafe<Array<Record<string, bigint>>>(`
    SELECT
      COUNT(*) FILTER (WHERE comicvine_id IS NOT NULL) AS has_cv,
      COUNT(*) FILTER (WHERE isbn_13 IS NOT NULL) AS has_isbn,
      COUNT(*) FILTER (WHERE comicvine_id IS NOT NULL AND isbn_13 IS NOT NULL) AS has_both,
      COUNT(*) FILTER (WHERE comicvine_id IS NULL AND isbn_13 IS NULL) AS has_neither
    FROM canonical_products WHERE deleted_at IS NULL AND cover_image_url IS NULL
  `)
  console.log('\n── MISSING-cover by source availability ──')
  console.log(`  has ComicVine id   : ${n(src.has_cv).toLocaleString()}  (Priority 1 — genuine art)`)
  console.log(`  has ISBN-13        : ${n(src.has_isbn).toLocaleString()}  (Priority 2/3 — OL/GB)`)
  console.log(`  has both           : ${n(src.has_both).toLocaleString()}`)
  console.log(`  has NEITHER        : ${n(src.has_neither).toLocaleString()}  (likely unrecoverable free)`)

  // Visible (>=1 live listing) null-cover
  const [vis] = await prisma.$queryRawUnsafe<Array<Record<string, bigint>>>(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE comicvine_id IS NOT NULL) AS has_cv,
      COUNT(*) FILTER (WHERE isbn_13 IS NOT NULL) AS has_isbn
    FROM canonical_products cp WHERE cp.deleted_at IS NULL AND cp.cover_image_url IS NULL
      AND EXISTS (SELECT 1 FROM retailer_listings rl WHERE rl.canonical_product_id=cp.id AND rl.deleted_at IS NULL)
  `)
  console.log('\n── VISIBLE (has live listing) MISSING-cover ──')
  console.log(`  total visible no-cover : ${n(vis.total).toLocaleString()}`)
  console.log(`    recoverable via CV   : ${n(vis.has_cv).toLocaleString()}`)
  console.log(`    recoverable via ISBN : ${n(vis.has_isbn).toLocaleString()}`)

  // By format
  const fmts = await prisma.$queryRawUnsafe<Array<{ format: string; c: bigint; cv: bigint; isbn: bigint }>>(`
    SELECT format::text AS format, COUNT(*) AS c,
           COUNT(*) FILTER (WHERE comicvine_id IS NOT NULL) AS cv,
           COUNT(*) FILTER (WHERE isbn_13 IS NOT NULL) AS isbn
    FROM canonical_products WHERE deleted_at IS NULL AND cover_image_url IS NULL
    GROUP BY format ORDER BY COUNT(*) DESC
  `)
  console.log('\n── MISSING-cover by format (count / CV-able / ISBN-able) ──')
  for (const f of fmts) console.log(`  ${f.format.padEnd(14)} ${n(f.c).toLocaleString().padStart(7)}  cv:${n(f.cv).toLocaleString().padStart(6)}  isbn:${n(f.isbn).toLocaleString().padStart(6)}`)

  // Launch series gaps
  console.log('\n── LAUNCH SERIES missing covers (registry) ──')
  let seriesNull = 0, seriesTotal = 0
  for (const [slug, entry] of Object.entries(SERIES_REGISTRY)) {
    const total = await prisma.canonicalProduct.count({ where: { comicvineId: entry.cvVolumeId, deletedAt: null } })
    const miss = await prisma.canonicalProduct.count({ where: { comicvineId: entry.cvVolumeId, deletedAt: null, coverImageUrl: null } })
    seriesTotal += total; seriesNull += miss
    if (miss > 0) console.log(`  ${slug.padEnd(28)} ${miss}/${total} missing`)
  }
  console.log(`  TOTAL launch-series missing: ${seriesNull}/${seriesTotal}`)
  await prisma.$disconnect()
}
main().catch(e => { console.error('ERR', e); process.exit(1) })
