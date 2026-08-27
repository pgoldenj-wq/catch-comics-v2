/**
 * audit-isbn-truth.ts — READ-ONLY ISBN truth audit for canonical_products
 * and retailer_listings.
 *
 * Pure SQL aggregation. Nothing is downloaded into Node beyond the aggregate
 * rows themselves, so Neon egress stays in the kilobytes rather than the
 * gigabytes a `SELECT *` sweep of 150k products would cost.
 *
 * Checksum arithmetic runs SERVER-SIDE as inline SQL (see ISBN13_VALID /
 * ISBN10_VALID) so that "valid" here means exactly what lib/identity/isbn.ts
 * means by it.
 *
 * Writes: NONE. Ever. This script has no --write mode by design.
 */

import { prisma } from '../lib/prisma'

// ── Server-side checksum expressions ─────────────────────────────────────────
// Weighted mod-10 for ISBN-13, weighted mod-11 for ISBN-10 (X = 10).
// Guarded by a shape regex so substr()::int can never throw on junk.

const ISBN13_SHAPE = (c: string) => `${c} ~ '^[0-9]{13}$'`
const ISBN13_VALID = (c: string) => `(
  ${ISBN13_SHAPE(c)} AND
  (10 - ((
    substr(${c},1,1)::int*1  + substr(${c},2,1)::int*3  + substr(${c},3,1)::int*1  +
    substr(${c},4,1)::int*3  + substr(${c},5,1)::int*1  + substr(${c},6,1)::int*3  +
    substr(${c},7,1)::int*1  + substr(${c},8,1)::int*3  + substr(${c},9,1)::int*1  +
    substr(${c},10,1)::int*3 + substr(${c},11,1)::int*1 + substr(${c},12,1)::int*3
  ) % 10)) % 10 = substr(${c},13,1)::int
)`

const ISBN10_SHAPE = (c: string) => `${c} ~ '^[0-9]{9}[0-9Xx]$'`
const ISBN10_VALID = (c: string) => `(
  ${ISBN10_SHAPE(c)} AND
  (
    substr(${c},1,1)::int*10 + substr(${c},2,1)::int*9 + substr(${c},3,1)::int*8 +
    substr(${c},4,1)::int*7  + substr(${c},5,1)::int*6 + substr(${c},6,1)::int*5 +
    substr(${c},7,1)::int*4  + substr(${c},8,1)::int*3 + substr(${c},9,1)::int*2 +
    (CASE WHEN upper(substr(${c},10,1))='X' THEN 10 ELSE substr(${c},10,1)::int END)
  ) % 11 = 0
)`

/** 978/979 are the only ISBN Bookland prefixes. Everything else is a plain EAN. */
const BOOK_PREFIX = (c: string) => `(substr(${c},1,3) IN ('978','979'))`

async function q<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  return prisma.$queryRawUnsafe<T[]>(sql)
}

const n = (v: unknown) => Number(v ?? 0)
const pad = (s: string, w: number) => s.padEnd(w)
const num = (v: unknown, w = 9) => n(v).toLocaleString('en-GB').padStart(w)

async function main() {
  console.log('\n══════════ ISBN TRUTH AUDIT — canonical_products ══════════\n')

  // ── 1. Headline totals ─────────────────────────────────────────────────────
  const [t] = await q(`
    SELECT
      COUNT(*)                                                        AS total_all,
      COUNT(*) FILTER (WHERE deleted_at IS NULL)                      AS total_live,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND isbn_13 IS NOT NULL) AS has13,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND isbn_10 IS NOT NULL) AS has10,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND ean     IS NOT NULL) AS has_ean,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND isbn_13 IS NULL AND isbn_10 IS NULL) AS no_isbn_at_all,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND isbn_13 IS NULL AND isbn_10 IS NOT NULL) AS only10,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND isbn_13 IS NOT NULL AND isbn_10 IS NULL) AS only13,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND isbn_13 IS NOT NULL AND isbn_10 IS NOT NULL) AS both
    FROM canonical_products
  `)
  console.log(`  total products (incl. soft-deleted) : ${num(t.total_all)}`)
  console.log(`  LIVE products (deleted_at IS NULL)  : ${num(t.total_live)}`)
  console.log(`  ── of the live rows ──`)
  console.log(`  has isbn_13                         : ${num(t.has13)}`)
  console.log(`  has isbn_10                         : ${num(t.has10)}`)
  console.log(`  has ean                             : ${num(t.has_ean)}`)
  console.log(`  isbn_13 only                        : ${num(t.only13)}`)
  console.log(`  isbn_10 only  (<-- 13 derivable?)   : ${num(t.only10)}`)
  console.log(`  both                                : ${num(t.both)}`)
  console.log(`  NEITHER                             : ${num(t.no_isbn_at_all)}`)

  // ── 2. Validity of stored isbn_13 ──────────────────────────────────────────
  console.log('\n─────────── isbn_13 validity (live rows) ───────────\n')
  const [v13] = await q(`
    SELECT
      COUNT(*)                                                     AS stored,
      COUNT(*) FILTER (WHERE NOT (${ISBN13_SHAPE('isbn_13')}))     AS bad_shape,
      COUNT(*) FILTER (WHERE ${ISBN13_SHAPE('isbn_13')} AND NOT ${BOOK_PREFIX('isbn_13')}) AS non_book_prefix,
      COUNT(*) FILTER (WHERE ${ISBN13_SHAPE('isbn_13')} AND ${BOOK_PREFIX('isbn_13')} AND NOT ${ISBN13_VALID('isbn_13')}) AS bad_checksum,
      COUNT(*) FILTER (WHERE ${ISBN13_VALID('isbn_13')} AND ${BOOK_PREFIX('isbn_13')}) AS fully_valid,
      COUNT(*) FILTER (WHERE isbn_13 ~ '[^0-9]')                   AS contains_nondigit,
      COUNT(*) FILTER (WHERE isbn_13 <> btrim(isbn_13))            AS has_whitespace,
      COUNT(*) FILTER (WHERE isbn_13 ~ '^0{13}$')                  AS all_zero
    FROM canonical_products
    WHERE deleted_at IS NULL AND isbn_13 IS NOT NULL
  `)
  console.log(`  stored isbn_13 values               : ${num(v13.stored)}`)
  console.log(`  FULLY VALID (shape+prefix+checksum) : ${num(v13.fully_valid)}`)
  console.log(`  malformed shape (not 13 digits)     : ${num(v13.bad_shape)}`)
  console.log(`  non-book prefix (not 978/979 = EAN) : ${num(v13.non_book_prefix)}`)
  console.log(`  INVALID CHECKSUM                    : ${num(v13.bad_checksum)}`)
  console.log(`  contains a non-digit character      : ${num(v13.contains_nondigit)}`)
  console.log(`  untrimmed whitespace                : ${num(v13.has_whitespace)}`)
  console.log(`  all-zero placeholder                : ${num(v13.all_zero)}`)

  // ── 3. Validity of stored isbn_10 ──────────────────────────────────────────
  console.log('\n─────────── isbn_10 validity (live rows) ───────────\n')
  const [v10] = await q(`
    SELECT
      COUNT(*)                                                 AS stored,
      COUNT(*) FILTER (WHERE ${ISBN10_VALID('isbn_10')})       AS valid,
      COUNT(*) FILTER (WHERE NOT ${ISBN10_SHAPE('isbn_10')})   AS bad_shape,
      COUNT(*) FILTER (WHERE ${ISBN10_SHAPE('isbn_10')} AND NOT ${ISBN10_VALID('isbn_10')}) AS bad_checksum
    FROM canonical_products
    WHERE deleted_at IS NULL AND isbn_10 IS NOT NULL
  `)
  console.log(`  stored isbn_10 values               : ${num(v10.stored)}`)
  console.log(`  valid isbn_10                       : ${num(v10.valid)}`)
  console.log(`  malformed shape                     : ${num(v10.bad_shape)}`)
  console.log(`  invalid checksum                    : ${num(v10.bad_checksum)}`)

  // ── 4. Coverage broken down by format ──────────────────────────────────────
  console.log('\n─────────── by product format (LIVE) ───────────\n')
  const byFmt = await q(`
    SELECT format::text AS format,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE ${ISBN13_VALID('isbn_13')} AND ${BOOK_PREFIX('isbn_13')}) AS valid13,
      COUNT(*) FILTER (WHERE isbn_13 IS NULL AND isbn_10 IS NULL) AS none,
      COUNT(*) FILTER (WHERE isbn_13 IS NULL AND ${ISBN10_VALID('isbn_10')}) AS only_valid10,
      COUNT(*) FILTER (WHERE isbn_13 IS NOT NULL AND NOT (${ISBN13_VALID('isbn_13')} AND ${BOOK_PREFIX('isbn_13')})) AS broken13
    FROM canonical_products WHERE deleted_at IS NULL
    GROUP BY 1 ORDER BY 2 DESC
  `)
  console.log(`  ${pad('format', 14)} ${'total'.padStart(9)} ${'valid13'.padStart(9)} ${'no-isbn'.padStart(9)} ${'only10'.padStart(8)} ${'broken13'.padStart(9)}`)
  for (const r of byFmt) {
    console.log(`  ${pad(String(r.format), 14)} ${num(r.total)} ${num(r.valid13)} ${num(r.none)} ${num(r.only_valid10, 8)} ${num(r.broken13)}`)
  }

  // ── 5. Duplicate ISBNs across canonical products ───────────────────────────
  console.log('\n─────────── duplicate isbn_13 across LIVE products ───────────\n')
  const [dup] = await q(`
    WITH d AS (
      SELECT isbn_13, COUNT(*) AS c FROM canonical_products
      WHERE deleted_at IS NULL AND isbn_13 IS NOT NULL
      GROUP BY 1 HAVING COUNT(*) > 1
    )
    SELECT COUNT(*) AS dup_isbns, COALESCE(SUM(c),0) AS dup_rows FROM d
  `)
  console.log(`  ISBN values on >1 live product      : ${num(dup.dup_isbns)}`)
  console.log(`  products involved                   : ${num(dup.dup_rows)}`)

  // ── 6. isbn_10 that disagrees with isbn_13 on the SAME row ────────────────
  console.log('\n─────────── internal conflict (isbn_10 vs isbn_13 on one row) ───────────\n')
  const [conf] = await q(`
    SELECT
      COUNT(*) AS both_present,
      COUNT(*) FILTER (
        WHERE ${ISBN10_VALID('isbn_10')} AND ${ISBN13_VALID('isbn_13')}
          AND '978' || substr(isbn_10,1,9) <> substr(isbn_13,1,12)
      ) AS disagree
    FROM canonical_products
    WHERE deleted_at IS NULL AND isbn_13 IS NOT NULL AND isbn_10 IS NOT NULL
  `)
  console.log(`  rows with both identifiers          : ${num(conf.both_present)}`)
  console.log(`  where the 10 does NOT match the 13  : ${num(conf.disagree)}`)

  // ── 7. retailer_listings side ──────────────────────────────────────────────
  console.log('\n══════════ retailer_listings ══════════\n')
  const [rl] = await q(`
    SELECT
      COUNT(*)                                                     AS live_listings,
      COUNT(*) FILTER (WHERE isbn_13 IS NOT NULL)                  AS with13,
      COUNT(*) FILTER (WHERE ${ISBN13_VALID('isbn_13')} AND ${BOOK_PREFIX('isbn_13')}) AS valid13,
      COUNT(*) FILTER (WHERE isbn_13 IS NOT NULL AND NOT (${ISBN13_VALID('isbn_13')} AND ${BOOK_PREFIX('isbn_13')})) AS broken13,
      COUNT(*) FILTER (WHERE match_method = 'ISBN')                AS matched_isbn
    FROM retailer_listings WHERE deleted_at IS NULL
  `)
  console.log(`  live listings                       : ${num(rl.live_listings)}`)
  console.log(`  carrying an isbn_13                 : ${num(rl.with13)}`)
  console.log(`  ...of which fully valid             : ${num(rl.valid13)}`)
  console.log(`  ...of which BROKEN                  : ${num(rl.broken13)}`)
  console.log(`  match_method = ISBN                 : ${num(rl.matched_isbn)}`)

  // ── 8. Listings whose ISBN disagrees with the canonical they point at ─────
  console.log('\n─────────── listing/canonical ISBN disagreement ───────────\n')
  const [mm] = await q(`
    SELECT
      COUNT(*) AS joined,
      COUNT(*) FILTER (WHERE l.isbn_13 <> c.isbn_13) AS mismatched
    FROM retailer_listings l
    JOIN canonical_products c ON c.id = l.canonical_product_id
    WHERE l.deleted_at IS NULL AND c.deleted_at IS NULL
      AND l.isbn_13 IS NOT NULL AND c.isbn_13 IS NOT NULL
  `)
  console.log(`  listings joined w/ both ISBNs set   : ${num(mm.joined)}`)
  console.log(`  listing ISBN != canonical ISBN      : ${num(mm.mismatched)}`)

  console.log('')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
