/**
 * b4-select-candidates.ts — READ-ONLY.
 *
 * Ranks candidate Travelling Man rows for the bounded B4 recovery.
 *
 * Scope is pinned to the ONE transaction the 27 October retention sweep ran:
 * deleted_at = 2026-10-27T03:00:46.263Z (2,246 rows). Every other deletion
 * cohort — including the 15,922 rows suppressed manually at 14:37 on 13 May,
 * which is not a 03:00 cron timestamp — is excluded by construction.
 *
 * Zero writes. No HTTP. Nothing but SELECTs.
 *
 *   npx dotenv -e <main-checkout>/.env.local -- npx tsx scripts/b4-select-candidates.ts
 */
import { PrismaClient }             from '@prisma/client'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join }            from 'node:path'

const prisma = new PrismaClient()

/** The single sweep transaction this recovery is allowed to reverse. */
export const SWEEP_AT = new Date('2026-10-27T03:00:46.263Z')

const n = (v: unknown) => Number(v)

async function main() {
  const out: Record<string, unknown> = {
    runAt:   new Date().toISOString(),
    mode:    'READ-ONLY (zero writes, zero HTTP)',
    sweepAt: SWEEP_AT.toISOString(),
  }

  // ── Confirm the cohort size before trusting it ────────────────────────────
  const cohort = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c
    FROM retailer_listings rl JOIN retailers r ON r.id = rl.retailer_id
    WHERE r.domain = 'travellingman.com' AND rl.deleted_at = ${SWEEP_AT}`
  out.cohortRows = n(cohort[0].c)

  // ── World of Books deletion cohorts, for the overlap question ─────────────
  const wob = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT rl.deleted_at, COUNT(*)::bigint AS rows
    FROM retailer_listings rl JOIN retailers r ON r.id = rl.retailer_id
    WHERE r.domain = 'worldofbooks.com' AND rl.deleted_at IS NOT NULL
    GROUP BY rl.deleted_at ORDER BY COUNT(*) DESC LIMIT 6`
  out.wobDeletionCohorts = wob.map(r => ({ ...r, rows: n(r.rows) }))

  // ── How many swept TM rows share a canonical product with a second
  //    retailer that is itself revivable (priced, swept rather than manual)?
  const overlap = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT o_r.name AS other_retailer,
           COUNT(DISTINCT rl.canonical_product_id)::bigint AS shared_products,
           COUNT(*) FILTER (WHERE o.price_amount > 0)::bigint AS other_rows_priced
    FROM retailer_listings rl
    JOIN retailers r   ON r.id = rl.retailer_id
    JOIN retailer_listings o ON o.canonical_product_id = rl.canonical_product_id
                            AND o.retailer_id <> rl.retailer_id
    JOIN retailers o_r ON o_r.id = o.retailer_id
    WHERE r.domain = 'travellingman.com'
      AND rl.deleted_at = ${SWEEP_AT}
      AND rl.canonical_product_id IS NOT NULL
    GROUP BY o_r.name
    ORDER BY COUNT(DISTINCT rl.canonical_product_id) DESC`
  out.overlapByRetailer = overlap.map(r => ({
    ...r, shared_products: n(r.shared_products), other_rows_priced: n(r.other_rows_priced),
  }))

  // ── Stored availability across the cohort ─────────────────────────────────
  // A sold-out offer can never be published as purchasable, so this is the
  // ceiling on how much of the sweep is recoverable at all.
  const stock = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT rl.stock_status::text AS stock_status,
           COUNT(*)::bigint AS rows,
           COUNT(*) FILTER (WHERE rl.price_amount > 0)::bigint AS priced
    FROM retailer_listings rl JOIN retailers r ON r.id = rl.retailer_id
    WHERE r.domain = 'travellingman.com' AND rl.deleted_at = ${SWEEP_AT}
    GROUP BY rl.stock_status ORDER BY COUNT(*) DESC`
  out.cohortStockStatus = stock.map(s => ({ ...s, rows: n(s.rows), priced: n(s.priced) }))

  // ── Ranked candidate shortlist ────────────────────────────────────────────
  // Requires: a real stored price, a canonical product to attach to, and an
  // ISBN on either side. Stored availability ranks FIRST — an offer that was
  // already sold out on 26 September is the least likely to verify live, and
  // could not be published as purchasable even if it did. Overlap with another
  // retailer breaks ties, then price descending.
  const candidates = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT rl.id, rl.retailer_sku, rl.retailer_url, rl.price_amount, rl.price_currency,
           rl.stock_status::text AS stock_status, rl.condition::text AS condition,
           rl.isbn_13 AS listing_isbn, rl.last_seen_at,
           cp.id AS canonical_product_id, cp.canonical_slug, cp.title,
           cp.format::text AS format, cp.publisher, cp.isbn_13 AS product_isbn,
           (SELECT COUNT(DISTINCT o.retailer_id) FROM retailer_listings o
              WHERE o.canonical_product_id = rl.canonical_product_id
                AND o.retailer_id <> rl.retailer_id
                AND o.price_amount > 0) AS other_priced_retailers
    FROM retailer_listings rl
    JOIN retailers r          ON r.id  = rl.retailer_id
    JOIN canonical_products cp ON cp.id = rl.canonical_product_id
    WHERE r.domain = 'travellingman.com'
      AND rl.deleted_at = ${SWEEP_AT}
      AND rl.price_amount > 0
      AND (rl.isbn_13 IS NOT NULL OR cp.isbn_13 IS NOT NULL)
    ORDER BY (rl.stock_status = 'IN_STOCK') DESC,
             (SELECT COUNT(DISTINCT o.retailer_id) FROM retailer_listings o
                WHERE o.canonical_product_id = rl.canonical_product_id
                  AND o.retailer_id <> rl.retailer_id
                  AND o.price_amount > 0) DESC,
             rl.price_amount DESC
    LIMIT 25`

  out.candidates = candidates.map(c => ({
    ...c,
    price_amount: String(c.price_amount),
    other_priced_retailers: n(c.other_priced_retailers),
  }))
  out.candidateCount = candidates.length

  await prisma.$disconnect()

  const p = join(process.cwd(), 'launch', 'operations', 'b4-candidates-latest.json')
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(out, null, 2))

  console.log(`sweep cohort rows: ${out.cohortRows}`)
  console.log(`\nstored availability across the cohort:`)
  for (const s of out.cohortStockStatus as Record<string, unknown>[]) {
    console.log(`  ${String(s.stock_status).padEnd(14)} ${String(s.rows).padStart(5)} rows   ${s.priced} priced`)
  }
  console.log(`\nWoB deletion cohorts:`)
  for (const w of out.wobDeletionCohorts as Record<string, unknown>[]) {
    console.log(`  ${w.deleted_at}  ${w.rows} rows`)
  }
  console.log(`\noverlap — other retailers holding a PRICED row for the same edition:`)
  for (const o of out.overlapByRetailer as Record<string, unknown>[]) {
    console.log(`  ${String(o.other_retailer).padEnd(22)} shared products ${String(o.shared_products).padStart(5)}   priced rows ${o.other_rows_priced}`)
  }
  console.log(`\nranked candidates (${out.candidateCount}):`)
  for (const c of out.candidates as Record<string, unknown>[]) {
    console.log(`  £${String(c.price_amount).padStart(6)} ${String(c.stock_status).padEnd(12)} others=${c.other_priced_retailers}  ${String(c.title).slice(0, 52).padEnd(52)} ${c.canonical_slug}`)
  }
  console.log(`\nwritten: ${p}`)
}

main().catch(async e => {
  await prisma.$disconnect()
  console.error(e)
  process.exit(1)
})
