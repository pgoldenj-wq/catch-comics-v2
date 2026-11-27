/**
 * catalogue-metadata-gaps.ts — READ-ONLY. Measure the metadata gaps that make
 * search rank the wrong edition.
 *
 * WHY
 * ───
 * Searching "Berserk Deluxe Edition Volume 1" on 2026-11-27 returned
 * "No strong match", with the correct book (9781506711980) at rank 11 behind
 * six unrelated titles. The cause is not the scoring formula — it is that
 * Berserk Deluxe volumes 1-10 carry format=OTHER and publisher=NULL while
 * volumes 11-14 carry format=DELUXE and publisher="Dark Horse Comics". The
 * query matches the format and publisher signals, so the correctly-typed
 * siblings outrank the exact title match.
 *
 * The existing cleanup:noncomics tooling does NOT cover this: Bucket B+ is 88
 * rows, requires a strong publisher signal (these have none) and never assigns
 * DELUXE.
 *
 * This reports the size of the problem, and specifically the subset that is
 * repairable WITHOUT any external lookup: a product whose own series siblings
 * already carry the metadata it is missing. That is the cheapest, safest fix
 * available and needs no ComicVine budget.
 *
 * STRICTLY READ-ONLY. Run: npm run catalogue:gaps
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const n = (v: unknown) => Number(v ?? 0)

async function main() {
  // ── 1. Overall completeness, and completeness where it is visible ────────
  const [all] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE format::text = 'OTHER')::int      AS fmt_other,
           COUNT(*) FILTER (WHERE publisher IS NULL)::int           AS no_pub,
           COUNT(*) FILTER (WHERE release_date IS NULL)::int        AS no_date,
           COUNT(*) FILTER (WHERE format::text = 'OTHER' AND publisher IS NULL)::int AS both
    FROM canonical_products`

  // Only products a shopper can actually reach with a price matter for launch.
  const [priced] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT COUNT(DISTINCT cp.id)::int AS total,
           COUNT(DISTINCT cp.id) FILTER (WHERE cp.format::text = 'OTHER')::int AS fmt_other,
           COUNT(DISTINCT cp.id) FILTER (WHERE cp.publisher IS NULL)::int      AS no_pub,
           COUNT(DISTINCT cp.id) FILTER (WHERE cp.format::text = 'OTHER' AND cp.publisher IS NULL)::int AS both
    FROM canonical_products cp
    JOIN retailer_listings rl ON rl.canonical_product_id = cp.id
    WHERE rl.deleted_at IS NULL AND rl.price_amount > 0`

  console.log('\n## Catalogue metadata completeness\n')
  console.log(`  whole catalogue      ${n(all.total)} products`)
  console.log(`    format = OTHER     ${n(all.fmt_other)}  (${(n(all.fmt_other) / n(all.total) * 100).toFixed(1)}%)`)
  console.log(`    publisher IS NULL  ${n(all.no_pub)}  (${(n(all.no_pub) / n(all.total) * 100).toFixed(1)}%)`)
  console.log(`    release IS NULL    ${n(all.no_date)}  (${(n(all.no_date) / n(all.total) * 100).toFixed(1)}%)`)
  console.log(`    BOTH fmt+pub gone  ${n(all.both)}  (${(n(all.both) / n(all.total) * 100).toFixed(1)}%)`)
  console.log(`\n  SHOPPER-VISIBLE (has a priced offer)   ${n(priced.total)} products`)
  console.log(`    format = OTHER     ${n(priced.fmt_other)}  (${(n(priced.fmt_other) / Math.max(1, n(priced.total)) * 100).toFixed(1)}%)`)
  console.log(`    publisher IS NULL  ${n(priced.no_pub)}  (${(n(priced.no_pub) / Math.max(1, n(priced.total)) * 100).toFixed(1)}%)`)
  console.log(`    BOTH fmt+pub gone  ${n(priced.both)}  (${(n(priced.both) / Math.max(1, n(priced.total)) * 100).toFixed(1)}%)`)

  // ── 2. Repairable from a product's OWN series siblings ───────────────────
  // No external lookup, no API budget: the answer is already in the row next
  // to it. Only counts a series where the siblings AGREE, so an ambiguous
  // series is never guessed at.
  const sib = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    WITH gap AS (
      SELECT id, series_name, format::text AS fmt, publisher
      FROM canonical_products
      WHERE series_name IS NOT NULL
        AND (format::text = 'OTHER' OR publisher IS NULL)
    ),
    good AS (
      SELECT series_name,
             COUNT(DISTINCT format::text) FILTER (WHERE format::text <> 'OTHER') AS fmt_variants,
             MIN(format::text) FILTER (WHERE format::text <> 'OTHER')            AS fmt_fill,
             COUNT(DISTINCT publisher) FILTER (WHERE publisher IS NOT NULL)      AS pub_variants,
             MIN(publisher) FILTER (WHERE publisher IS NOT NULL)                 AS pub_fill
      FROM canonical_products
      WHERE series_name IS NOT NULL
      GROUP BY series_name
    )
    SELECT COUNT(*)::int AS repairable,
           COUNT(*) FILTER (WHERE g.fmt = 'OTHER' AND good.fmt_variants = 1)::int AS fmt_fixable,
           COUNT(*) FILTER (WHERE g.publisher IS NULL AND good.pub_variants = 1)::int AS pub_fixable
    FROM gap g JOIN good ON good.series_name = g.series_name
    WHERE (g.fmt = 'OTHER' AND good.fmt_variants = 1)
       OR (g.publisher IS NULL AND good.pub_variants = 1)`

  console.log('\n## Repairable from the product\'s own series siblings (no external lookup)\n')
  console.log(`  products with an unambiguous sibling fill : ${n(sib[0]?.repairable)}`)
  console.log(`    ...format fillable                      : ${n(sib[0]?.fmt_fixable)}`)
  console.log(`    ...publisher fillable                   : ${n(sib[0]?.pub_fixable)}`)

  // ── 3. The worked example, so the claim is checkable ─────────────────────
  const berserk = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT title, format::text AS fmt, publisher, isbn_13 AS isbn, series_name AS series
    FROM canonical_products
    WHERE title ILIKE 'Berserk Deluxe%'
    ORDER BY title`
  console.log('\n## Worked example — Berserk Deluxe\n')
  for (const b of berserk) {
    console.log(`  ${String(b.title).padEnd(26)} fmt=${String(b.fmt).padEnd(8)} pub=${String(b.publisher ?? 'NULL').padEnd(20)} series=${b.series ?? 'NULL'}`)
  }

  await prisma.$disconnect()
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
