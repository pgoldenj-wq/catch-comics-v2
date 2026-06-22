/**
 * audit-covers.ts — READ-ONLY cover-quality diagnostic for Operation Cover Zero.
 *
 * Performs ZERO writes. Pure SELECT/count queries + in-memory classification.
 * Safe to run against production at any time.
 *
 * Reports:
 *   A. Global cover-source breakdown (all live canonical_products)
 *   B. "Visible" set — products with >=1 live retailer listing (what users can reach)
 *   C. Format distribution (all live + visible)
 *   D. Bad / placeholder cover URLs (per lib/images/url-filters rules)
 *   E. Non-comic suspects among the visible-with-cover set (classifyText)
 *   F. Series-registry cover coverage (the 17 launch series)
 *
 * Run: npx dotenv -e .env.local -- tsx scripts/audit-covers.ts
 */

import { prisma }                 from '../lib/prisma'
import { isBadCoverUrl }          from '../lib/images/url-filters'
import { classifyText }           from '../lib/search/isLikelyComic'
import { SERIES_REGISTRY }        from '../lib/series/registry'
import { getSeriesData }          from '../lib/series/getSeriesData'

const n = (v: unknown) => Number(v as bigint | number)
const pctOf = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—')

// Host classification expressed once as SQL CASE fragments (read-only).
const HOST_BREAKDOWN = `
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE cover_image_url IS NULL) AS null_cover,
  COUNT(*) FILTER (WHERE cover_image_url ILIKE '%images.catchcomics.com%'
                      OR cover_image_url ILIKE '%r2.dev%'
                      OR cover_image_url ILIKE '%cloudflarestorage%') AS r2,
  COUNT(*) FILTER (WHERE cover_image_url ILIKE '%covers.openlibrary.org%') AS openlibrary,
  COUNT(*) FILTER (WHERE cover_image_url ILIKE '%comicvine%') AS comicvine,
  COUNT(*) FILTER (WHERE cover_image_url ILIKE '%books.google.com%') AS googlebooks,
  COUNT(*) FILTER (WHERE cover_image_url ILIKE '%bookshop%') AS bookshop,
  COUNT(*) FILTER (WHERE cover_image_url ILIKE '%amazon%') AS amazon,
  COUNT(*) FILTER (WHERE cover_image_url IS NOT NULL
                      AND cover_image_url NOT ILIKE '%images.catchcomics.com%'
                      AND cover_image_url NOT ILIKE '%r2.dev%'
                      AND cover_image_url NOT ILIKE '%cloudflarestorage%'
                      AND cover_image_url NOT ILIKE '%covers.openlibrary.org%'
                      AND cover_image_url NOT ILIKE '%comicvine%'
                      AND cover_image_url NOT ILIKE '%books.google.com%'
                      AND cover_image_url NOT ILIKE '%bookshop%'
                      AND cover_image_url NOT ILIKE '%amazon%') AS other_host,
  COUNT(*) FILTER (WHERE cover_image_url ILIKE '%no_image%'
                      OR cover_image_url ILIKE '%image_not_available%'
                      OR cover_image_url ILIKE '%not_available%'
                      OR cover_image_url ~ '/uploads/[^/]+/0/[0-9]+/'
                      OR cover_image_url ILIKE '%books.google.com%') AS bad_url
`

interface Row {
  total: bigint; null_cover: bigint; r2: bigint; openlibrary: bigint
  comicvine: bigint; googlebooks: bigint; bookshop: bigint; amazon: bigint
  other_host: bigint; bad_url: bigint
}

function printBreakdown(label: string, r: Row) {
  const total = n(r.total)
  const present = total - n(r.null_cover)
  console.log(`\n── ${label} ──`)
  console.log(`  Total live products      : ${total.toLocaleString()}`)
  console.log(`  Cover present (NOT NULL)  : ${present.toLocaleString()} (${pctOf(present, total)})`)
  console.log(`  NULL cover               : ${n(r.null_cover).toLocaleString()} (${pctOf(n(r.null_cover), total)})`)
  console.log(`  ── present, by host ──`)
  console.log(`    R2 (catchcomics CDN)   : ${n(r.r2).toLocaleString()} (${pctOf(n(r.r2), total)})`)
  console.log(`    Open Library (external): ${n(r.openlibrary).toLocaleString()} (${pctOf(n(r.openlibrary), total)})`)
  console.log(`    Comic Vine (external)  : ${n(r.comicvine).toLocaleString()} (${pctOf(n(r.comicvine), total)})`)
  console.log(`    Google Books (BAD)     : ${n(r.googlebooks).toLocaleString()} (${pctOf(n(r.googlebooks), total)})`)
  console.log(`    Bookshop (likely 403)  : ${n(r.bookshop).toLocaleString()} (${pctOf(n(r.bookshop), total)})`)
  console.log(`    Amazon                 : ${n(r.amazon).toLocaleString()} (${pctOf(n(r.amazon), total)})`)
  console.log(`    Other host             : ${n(r.other_host).toLocaleString()} (${pctOf(n(r.other_host), total)})`)
  console.log(`  ⚠ Bad/placeholder URL    : ${n(r.bad_url).toLocaleString()} (${pctOf(n(r.bad_url), total)})  [isBadCoverUrl rules]`)
  console.log(`  ✓ "Good" present covers  : ${(present - n(r.bad_url)).toLocaleString()} (${pctOf(present - n(r.bad_url), total)})`)
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  OPERATION COVER ZERO — read-only cover audit')
  console.log('  ' + new Date().toISOString())
  console.log('═══════════════════════════════════════════════════════════════')

  // ── A. Global breakdown (all live) ────────────────────────────────────────
  const [all] = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT ${HOST_BREAKDOWN} FROM canonical_products WHERE deleted_at IS NULL`
  )
  printBreakdown('A. ALL LIVE PRODUCTS', all)

  // ── B. Visible set: live products with >=1 live retailer listing ──────────
  const [vis] = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT ${HOST_BREAKDOWN}
       FROM canonical_products cp
      WHERE cp.deleted_at IS NULL
        AND EXISTS (
          SELECT 1 FROM retailer_listings rl
           WHERE rl.canonical_product_id = cp.id
             AND rl.deleted_at IS NULL
        )`
  )
  printBreakdown('B. VISIBLE SET (>=1 live listing — what users can reach)', vis)

  // ── C. Format distribution ────────────────────────────────────────────────
  const formats = await prisma.$queryRawUnsafe<Array<{ format: string; c: bigint; with_cover: bigint }>>(
    `SELECT format::text AS format,
            COUNT(*) AS c,
            COUNT(*) FILTER (WHERE cover_image_url IS NOT NULL) AS with_cover
       FROM canonical_products
      WHERE deleted_at IS NULL
      GROUP BY format
      ORDER BY COUNT(*) DESC`
  )
  console.log('\n── C. FORMAT DISTRIBUTION (all live) ──')
  for (const f of formats) {
    console.log(`  ${f.format.padEnd(16)} ${n(f.c).toLocaleString().padStart(8)}   cover: ${n(f.with_cover).toLocaleString()}`)
  }

  // ── D. Non-comic suspects in the VISIBLE set with a (good) cover ──────────
  // Pull title/publisher/format/cover for live products that have a listing AND
  // a non-null cover. Classify in JS. These are the covers users actually see.
  const visibleWithCover = await prisma.$queryRawUnsafe<Array<{
    id: string; title: string; publisher: string | null; format: string
    cover_image_url: string | null; canonical_slug: string
  }>>(
    `SELECT cp.id, cp.title, cp.publisher, cp.format::text AS format,
            cp.cover_image_url, cp.canonical_slug
       FROM canonical_products cp
      WHERE cp.deleted_at IS NULL
        AND cp.cover_image_url IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM retailer_listings rl
           WHERE rl.canonical_product_id = cp.id
             AND rl.deleted_at IS NULL
        )`
  )

  let nonComic = 0, uncertain = 0, comic = 0, badCover = 0
  const nonComicSamples: string[] = []
  for (const p of visibleWithCover) {
    if (isBadCoverUrl(p.cover_image_url)) badCover++
    const cls = classifyText(`${p.title} ${p.publisher ?? ''}`)
    if (cls === 'non-comic') {
      nonComic++
      if (nonComicSamples.length < 30) {
        nonComicSamples.push(`    [${p.format}] "${p.title}" — ${p.publisher ?? 'no publisher'}  (/${p.canonical_slug})`)
      }
    } else if (cls === 'uncertain') uncertain++
    else comic++
  }
  console.log('\n── D. NON-COMIC SUSPECTS in VISIBLE-with-cover set ──')
  console.log(`  Visible products with a cover : ${visibleWithCover.length.toLocaleString()}`)
  console.log(`    classified comic            : ${comic.toLocaleString()} (${pctOf(comic, visibleWithCover.length)})`)
  console.log(`    classified UNCERTAIN        : ${uncertain.toLocaleString()} (${pctOf(uncertain, visibleWithCover.length)})`)
  console.log(`    classified NON-COMIC        : ${nonComic.toLocaleString()} (${pctOf(nonComic, visibleWithCover.length)})`)
  console.log(`    (of those) bad cover URL    : ${badCover.toLocaleString()}`)
  console.log(`  Sample non-comic offenders (max 30):`)
  console.log(nonComicSamples.join('\n') || '    (none)')

  // ── E. Top Deals — the actual homepage carousel set ───────────────────────
  // Mirrors app/api/homepage-deals (without the dedup CTE) — what shows on the homepage.
  const deals = await prisma.$queryRawUnsafe<Array<{ title: string; cover_image_url: string | null; lc: bigint }>>(
    `SELECT cp.title, cp.cover_image_url, COUNT(rl.id) AS lc
       FROM canonical_products cp
       JOIN retailer_listings rl ON rl.canonical_product_id = cp.id
            AND rl.stock_status = 'IN_STOCK' AND rl.deleted_at IS NULL
      WHERE cp.deleted_at IS NULL AND cp.cover_image_url IS NOT NULL
        AND cp.format IN ('SINGLE_ISSUE','MANGA_VOLUME','OMNIBUS','ABSOLUTE','COMPENDIUM','DELUXE')
      GROUP BY cp.id, cp.title, cp.cover_image_url
      ORDER BY COUNT(rl.id) DESC
      LIMIT 20`
  )
  console.log('\n── E. TOP DEALS candidates (top 20 by listing count) ──')
  for (const d of deals) {
    const bad = isBadCoverUrl(d.cover_image_url) ? ' ⚠BAD-URL' : ''
    const host = (d.cover_image_url ?? '').replace(/^https?:\/\//, '').split('/')[0]
    console.log(`  ${n(d.lc).toString().padStart(4)}  ${bad.padEnd(9)} ${host.padEnd(28)} ${d.title.slice(0, 50)}`)
  }

  // ── F. Series registry cover coverage ─────────────────────────────────────
  console.log('\n── F. SERIES REGISTRY cover coverage (launch series) ──')
  const slugs = Object.keys(SERIES_REGISTRY)
  for (const slug of slugs) {
    try {
      const data = await getSeriesData(SERIES_REGISTRY[slug])
      const vols = data.volumes.length
      const withCover = data.volumes.filter(v => v.coverUrl).length
      const hero = data.heroCoverUrl ? 'hero✓' : 'hero✗'
      const flag = withCover < vols ? ' ⚠' : ''
      console.log(`  ${slug.padEnd(28)} ${hero}  vols ${withCover}/${vols} have cover${flag}`)
    } catch (e) {
      console.log(`  ${slug.padEnd(28)} ERROR: ${(e as Error).message.slice(0, 60)}`)
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  Audit complete — NO writes performed.')
  console.log('═══════════════════════════════════════════════════════════════')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
