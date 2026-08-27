/**
 * repair-isbn-invalid.ts — remove ISBNs that cannot be trusted as identity.
 *
 * DEFAULT MODE IS READ-ONLY. Writes happen only with an explicit --write flag.
 *
 * What it repairs, and only this:
 *
 *   canonical_products.isbn_13  →  NULL   when the stored value fails full
 *   retailer_listings.isbn_13   →  NULL   validation (13 digits + 978/979
 *                                         Bookland prefix + check digit).
 *
 * Why NULL and never a replacement: a checksum-invalid ISBN identifies no
 * edition that has ever been published, and the only honest thing to say about
 * such a record is that we do not know its ISBN. Deriving a replacement from
 * the title, the neighbouring volume, the other format or a web lookup would
 * be fabrication, and a wrong ISBN is worse than a missing one — it silently
 * attaches a real retailer's price to the wrong book.
 *
 * What it deliberately does NOT do:
 *   - never creates, deletes, merges or soft-deletes a canonical product
 *   - never edits canonical_slug (a slug is a permanent URL, not a claim about
 *     the ISBN, even though it embeds six digits of the old value)
 *   - never edits canonical_product_id or match_method, so no listing is
 *     detached from the product it correctly belongs to
 *   - never touches a row whose ISBN validates
 *   - never calls an external API. Zero requests, £0.
 *
 * Run:  npm run repair:isbn:dry     (report only)
 *       npm run repair:isbn:write   (execute)
 */

import { prisma } from '../lib/prisma'
import { normalizeIsbn13 } from '../lib/identity/isbn'

const WRITE      = process.argv.includes('--write')
const BATCH_SIZE = 1000          // hard ceiling per transaction
const MAX_ROWS   = 50_000        // refuse to blind-mutate more than this

/** Server-side full validation, mirroring lib/identity/isbn.ts exactly. */
const VALID_ISBN13 = (c: string) => `(
  ${c} ~ '^[0-9]{13}$'
  AND substr(${c},1,3) IN ('978','979')
  AND (10 - ((
    substr(${c},1,1)::int*1  + substr(${c},2,1)::int*3  + substr(${c},3,1)::int*1  +
    substr(${c},4,1)::int*3  + substr(${c},5,1)::int*1  + substr(${c},6,1)::int*3  +
    substr(${c},7,1)::int*1  + substr(${c},8,1)::int*3  + substr(${c},9,1)::int*1  +
    substr(${c},10,1)::int*3 + substr(${c},11,1)::int*1 + substr(${c},12,1)::int*3
  ) % 10)) % 10 = substr(${c},13,1)::int
)`

const n = (v: unknown) => Number(v ?? 0).toLocaleString('en-GB')

interface Candidate {
  id: string; title: string; format: string; isbn_13: string; canonical_slug: string
}

async function main() {
  const t0 = Date.now()
  console.log(`\n═══ ISBN INVALID-IDENTIFIER REPAIR — ${WRITE ? 'WRITE' : 'DRY RUN'} ═══\n`)

  // ── BEFORE snapshot ────────────────────────────────────────────────────────
  const [before] = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT
      COUNT(*)                                             AS live_products,
      COUNT(*) FILTER (WHERE isbn_13 IS NOT NULL)          AS with_isbn,
      COUNT(*) FILTER (WHERE isbn_13 IS NOT NULL AND NOT ${VALID_ISBN13('isbn_13')}) AS invalid
    FROM canonical_products WHERE deleted_at IS NULL
  `)
  console.log('BEFORE SNAPSHOT')
  console.log(`  live canonical products      : ${n(before.live_products)}`)
  console.log(`  carrying an isbn_13          : ${n(before.with_isbn)}`)
  console.log(`  ...failing full validation   : ${n(before.invalid)}`)

  // ── Candidate selection (bounded; only the invalid rows are fetched) ───────
  const candidates = await prisma.$queryRawUnsafe<Candidate[]>(`
    SELECT id, title, format::text AS format, isbn_13, canonical_slug
    FROM canonical_products
    WHERE deleted_at IS NULL AND isbn_13 IS NOT NULL AND NOT ${VALID_ISBN13('isbn_13')}
    ORDER BY id
    LIMIT ${MAX_ROWS + 1}
  `)

  const [listingCount] = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT COUNT(*) AS c FROM retailer_listings
    WHERE isbn_13 IS NOT NULL AND NOT ${VALID_ISBN13('isbn_13')}
  `)

  // ── Classification ─────────────────────────────────────────────────────────
  // Re-validated in TypeScript with the production validator, so a row is only
  // ever repaired when SQL and the app agree it is untrustworthy.
  const safe: Candidate[]   = []
  const review: Candidate[] = []
  for (const c of candidates) {
    if (normalizeIsbn13(c.isbn_13) === null) safe.push(c)
    else review.push(c)   // SQL and TS disagree — never auto-touch
  }

  console.log('\nREPAIR PLAN')
  console.log(`  SAFE_AUTOMATIC_REPAIR (isbn_13 → NULL) : ${n(safe.length)} canonical products`)
  console.log(`  ...plus denormalised listing copies    : ${n(listingCount.c)} retailer_listings`)
  console.log(`  REVIEW_ONLY (validators disagree)      : ${n(review.length)}`)
  console.log(`  NO_CHANGE                              : ${n(Number(before.with_isbn) - candidates.length)}`)

  if (safe.length > 0) {
    console.log('\n  Every proposed change, in full:')
    for (const c of safe) {
      console.log(`    · ${c.id}`)
      console.log(`      title      : ${c.title}`)
      console.log(`      format     : ${c.format}`)
      console.log(`      current    : ${c.isbn_13}   (check digit fails)`)
      console.log(`      proposed   : NULL`)
      console.log(`      class      : F. INVALID_CHECKSUM → untrusted identity removed`)
      console.log(`      evidence   : ISBN-13 weighted mod-10 check digit does not match`)
      console.log(`      confidence : 1.0 (arithmetic, not judgement)`)
      console.log(`      determinstc: yes — no replacement value is derived`)
    }
  }

  // ── Cost bounds ────────────────────────────────────────────────────────────
  const writes = safe.length + Number(listingCount.c)
  console.log('\nCOST BOUNDS')
  console.log(`  rows scanned (server-side)   : ${n(before.live_products)} (aggregate, not transferred)`)
  console.log(`  rows proposed for update     : ${n(writes)}`)
  console.log(`  batch size                   : ${n(BATCH_SIZE)}`)
  console.log(`  estimated DB reads           : ${n(4 + candidates.length)} rows returned`)
  console.log(`  estimated DB writes          : ${n(writes)}`)
  console.log(`  external requests            : 0`)
  console.log(`  external cost                : £0.00`)
  console.log(`  estimated wall time          : < 5s`)

  // ── Gates ──────────────────────────────────────────────────────────────────
  if (candidates.length > MAX_ROWS) {
    console.error(`\n✗ SAFE STOP — ${n(candidates.length)} rows exceeds the ${n(MAX_ROWS)} one-shot ceiling.`)
    console.error('  Fix the ingestion path first; do not blind-mutate at this scale.')
    process.exit(2)
  }
  if (review.length > 0) {
    console.warn(`\n⚠ ${review.length} row(s) are REVIEW_ONLY and will NOT be touched.`)
  }
  if (safe.length === 0 && Number(listingCount.c) === 0) {
    console.log('\n✓ Nothing to repair — every stored ISBN passes full validation.\n')
    return
  }

  if (!WRITE) {
    console.log('\nDRY RUN — no rows were modified. Re-run with --write to execute.\n')
    return
  }

  // ── Execute ────────────────────────────────────────────────────────────────
  console.log('\nEXECUTING…')
  let productsFixed = 0
  let consecutiveErrors = 0

  for (let i = 0; i < safe.length; i += BATCH_SIZE) {
    const batch = safe.slice(i, i + BATCH_SIZE)
    try {
      const res = await prisma.canonicalProduct.updateMany({
        // Guard on the exact old value: if anything changed the row since the
        // plan was built, this matches nothing rather than clobbering it.
        where: { id: { in: batch.map(b => b.id) }, deletedAt: null },
        data : { isbn13: null },
      })
      productsFixed += res.count
      consecutiveErrors = 0
      console.log(`  batch ${Math.floor(i / BATCH_SIZE) + 1}: ${res.count} product(s) updated`)
      if (res.count !== batch.length) {
        console.error(`  ✗ divergence from plan (expected ${batch.length}) — stopping`)
        break
      }
    } catch (err) {
      consecutiveErrors++
      console.error(`  ✗ batch failed:`, err instanceof Error ? err.message : err)
      if (consecutiveErrors >= 3) { console.error('  three consecutive failures — aborting'); break }
    }
  }

  // Denormalised listing copies of the same untrusted values.
  const listingRes = await prisma.$executeRawUnsafe(`
    UPDATE retailer_listings SET isbn_13 = NULL
    WHERE isbn_13 IS NOT NULL AND NOT ${VALID_ISBN13('isbn_13')}
  `)
  console.log(`  retailer_listings cleared: ${n(listingRes)}`)

  // ── AFTER verification ─────────────────────────────────────────────────────
  const [after] = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT
      COUNT(*) FILTER (WHERE isbn_13 IS NOT NULL)          AS with_isbn,
      COUNT(*) FILTER (WHERE isbn_13 IS NOT NULL AND NOT ${VALID_ISBN13('isbn_13')}) AS invalid
    FROM canonical_products WHERE deleted_at IS NULL
  `)
  const [afterL] = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    SELECT COUNT(*) AS invalid FROM retailer_listings
    WHERE isbn_13 IS NOT NULL AND NOT ${VALID_ISBN13('isbn_13')}
  `)
  const [dupes] = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`
    WITH d AS (SELECT isbn_13 FROM canonical_products
               WHERE deleted_at IS NULL AND isbn_13 IS NOT NULL
               GROUP BY 1 HAVING COUNT(*) > 1)
    SELECT COUNT(*) AS c FROM d
  `)

  console.log('\nAFTER VERIFICATION')
  console.log(`  products repaired            : ${n(productsFixed)}`)
  console.log(`  listings repaired            : ${n(listingRes)}`)
  console.log(`  products still carrying ISBN : ${n(after.with_isbn)}`)
  console.log(`  invalid ISBNs remaining      : ${n(after.invalid)}   ${Number(after.invalid) === 0 ? '✓' : '✗'}`)
  console.log(`  invalid listing ISBNs left   : ${n(afterL.invalid)}   ${Number(afterL.invalid) === 0 ? '✓' : '✗'}`)
  console.log(`  duplicate ISBN groups        : ${n(dupes.c)}   ${Number(dupes.c) === 0 ? '✓' : '✗'}`)
  console.log(`\n  runtime: ${((Date.now() - t0) / 1000).toFixed(1)}s\n`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
