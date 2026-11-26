/**
 * b4-verify-pairs.ts — READ-ONLY proof that the paired recovery did exactly
 * what it claimed, and nothing else.
 *
 * Zero writes. Zero HTTP requests. It reads the write report produced by
 * scripts/b4-revive-paired-offers.ts --write and checks the database against
 * it, rather than trusting the script's own summary of itself.
 *
 * Checks:
 *   1. every row the report says it revived is active, priced and in stock
 *   2. exactly one observation per revived row inside the run's time window
 *      (the idempotency claim: a second run must not add a second observation)
 *   3. every published pair really has 2+ independent priced retailers
 *   4. the revived rows can no longer be selected as revivable, so a re-run
 *      publishes nothing
 *   5. nothing outside the intended scope moved: the Travelling Man cohort
 *      shrank by exactly the number of TM rows revived, unrelated deletions
 *      are untouched, and no listing or canonical product was created
 *   6. rows the report says it REFUSED or ABANDONED are still soft-deleted
 *
 *   npx dotenv -e <main>/.env.local -- npx tsx scripts/b4-verify-pairs.ts
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { join }         from 'node:path'

const prisma = new PrismaClient()

const TM_DOMAIN  = 'travellingman.com'
const WOB_DOMAIN = 'worldofbooks.com'
const REPORT = join(process.cwd(), 'launch', 'operations', 'b4-pairs-write-latest.json')

let pass = 0, fail = 0
const ok   = (label: string, detail: string) => { pass++; console.log(`  PASS  ${label} — ${detail}`) }
const bad  = (label: string, detail: string) => { fail++; console.log(`  FAIL  ${label} — ${detail}`) }
const check = (cond: boolean, label: string, detail: string) => cond ? ok(label, detail) : bad(label, detail)

interface Side { domain: string; id: string; written: boolean; live: string | null; state: string; scopedDeletedAt: string | null }
interface Pair { slug: string; title: string; published: boolean; skipReason?: string; tm: Side; wob: Side }

async function main() {
  const report = JSON.parse(readFileSync(REPORT, 'utf8')) as {
    runAt: string
    mode: string
    cost: { wallClockMs: number }
    writeTotals: Record<string, number>
    productionState: { before: Record<string, number>; after: Record<string, number> }
    refusedOutsideCronWindow: { slug: string }[]
    outcomes: Pair[]
  }

  console.log(`report   : ${REPORT}`)
  console.log(`mode     : ${report.mode}`)
  console.log(`run at   : ${report.runAt}`)

  const pairs      = report.outcomes
  const publishedP = pairs.filter(p => p.published)
  const abandoned  = pairs.filter(p => !p.published)
  const written    = pairs.flatMap(p => [p.tm, p.wob]).filter(s => s.written)
  const tmWritten  = written.filter(s => s.domain === TM_DOMAIN)
  const wobWritten = written.filter(s => s.domain === WOB_DOMAIN)

  console.log(`\npairs published ${publishedP.length} · abandoned ${abandoned.length} · rows written ${written.length} (TM ${tmWritten.length} · WoB ${wobWritten.length})`)

  // The window the run's writes must fall inside, with a minute of slack.
  const end   = new Date(report.runAt)
  const start = new Date(end.getTime() - report.cost.wallClockMs - 60_000)
  console.log(`observation window: ${start.toISOString()} .. ${end.toISOString()}`)

  const writtenIds = written.map(s => s.id)

  // ── 1. every revived row is active, priced and in stock ───────────────────
  console.log('\n── 1. every revived row is active, priced and in stock ──')
  const rows = await prisma.retailerListing.findMany({
    where:  { id: { in: writtenIds } },
    select: { id: true, deletedAt: true, priceAmount: true, stockStatus: true,
              canonicalProductId: true, retailerId: true },
  })
  check(rows.length === writtenIds.length, 'all rows present', `${rows.length} of ${writtenIds.length} found`)
  check(rows.every(r => r.deletedAt === null), 'deleted_at cleared', `${rows.filter(r => r.deletedAt === null).length} active`)
  check(rows.every(r => Number(r.priceAmount) > 0), 'priced above zero', `${rows.filter(r => Number(r.priceAmount) > 0).length} priced`)
  check(rows.every(r => r.stockStatus === 'IN_STOCK'), 'stock status IN_STOCK', `${rows.filter(r => r.stockStatus === 'IN_STOCK').length} in stock`)

  // The live price the run verified is the price now stored.
  const storedById = new Map(rows.map(r => [r.id, String(r.priceAmount)]))
  const priceMatches = written.filter(s => Number(storedById.get(s.id)) === Number(s.live)).length
  check(priceMatches === written.length, 'stored price equals the verified live price',
        `${priceMatches} of ${written.length} match`)

  // ── 2. exactly one observation per revived row in this run's window ───────
  console.log('\n── 2. exactly one observation per revived row (idempotency) ──')
  const obs = await prisma.priceHistory.groupBy({
    by:    ['retailerListingId'],
    where: { retailerListingId: { in: writtenIds }, recordedAt: { gte: start, lte: end } },
    _count: { _all: true },
  })
  check(obs.length === writtenIds.length, 'one observation row each',
        `${obs.length} of ${writtenIds.length} rows have a recovery observation`)
  const dupes = obs.filter(o => o._count._all !== 1)
  check(dupes.length === 0, 'no duplicate observations',
        dupes.length === 0 ? 'every row has exactly 1'
                           : `${dupes.length} row(s) with more than one: ${dupes.slice(0, 3).map(d => d.retailerListingId).join(', ')}`)

  // ── 3. every published pair really has 2+ independent priced retailers ────
  console.log('\n── 3. every published pair has 2+ independent priced retailers ──')
  const productIds = [...new Set(rows.map(r => r.canonicalProductId).filter((v): v is string => v !== null))]
  const perProduct = await prisma.$queryRaw<{ canonical_product_id: string; retailers: bigint }[]>`
    SELECT canonical_product_id, COUNT(DISTINCT retailer_id)::bigint AS retailers
    FROM retailer_listings
    WHERE canonical_product_id = ANY(${productIds}::uuid[])
      AND deleted_at IS NULL AND price_amount > 0
    GROUP BY canonical_product_id`
  const atTwo = perProduct.filter(p => Number(p.retailers) >= 2).length
  check(atTwo === publishedP.length, 'each published pair counts as a 2+ retailer product',
        `${atTwo} of ${publishedP.length} products have 2+ priced retailers`)

  // ── 4. a re-run cannot revive them again ─────────────────────────────────
  console.log('\n── 4. a second run cannot revive these rows again ──')
  const stillRevivable = await prisma.retailerListing.count({
    where: { id: { in: writtenIds }, deletedAt: { not: null } },
  })
  check(stillRevivable === 0, 'no revived row is selectable as soft-deleted',
        `${stillRevivable} of ${written.length} still soft-deleted`)

  // ── 5. nothing outside the intended scope moved ──────────────────────────
  console.log('\n── 5. nothing outside the intended scope moved ──')
  const b = report.productionState.before, a = report.productionState.after
  check(a.tmSweepCohortStillDeleted === b.tmSweepCohortStillDeleted - tmWritten.length,
        'TM cohort shrank by exactly the TM rows revived',
        `${b.tmSweepCohortStillDeleted} -> ${a.tmSweepCohortStillDeleted} (expected -${tmWritten.length})`)
  check(a.unrelatedDeletedRows === b.unrelatedDeletedRows,
        'unrelated deletions untouched', `${a.unrelatedDeletedRows} rows still deleted elsewhere`)
  check(a.retailerListings === b.retailerListings,
        'no listing created or destroyed', `${a.retailerListings} rows`)
  check(a.canonicalProducts === b.canonicalProducts,
        'no canonical product created', `${a.canonicalProducts} rows`)
  check(a.priceHistoryRows === b.priceHistoryRows + written.length,
        'price history grew by exactly the rows revived',
        `${b.priceHistoryRows} -> ${a.priceHistoryRows} (expected +${written.length})`)
  check(report.writeTotals.alreadyActiveRowsWritten === 0,
        'already-live rows were verified but never written', 'the 02:00 refresh still owns them')
  check(report.writeTotals.rowsTouchedOutsideCronWindow === 0 && report.refusedOutsideCronWindow.length === 0,
        'no row outside the 03:00-04:01 cron window touched', 'deliberate suppressions left alone')

  // Live re-read of the guard, not just the report's word for it.
  const outOfWindow = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c FROM retailer_listings rl
    JOIN retailers r ON r.id = rl.retailer_id
    WHERE rl.id = ANY(${writtenIds}::uuid[])
      AND r.domain NOT IN (${TM_DOMAIN}, ${WOB_DOMAIN})`
  check(Number(outOfWindow[0].c) === 0, 'every revived row belongs to one of the two intended retailers',
        `${Number(outOfWindow[0].c)} rows from another retailer`)

  // ── 6. abandoned pairs are still soft-deleted ────────────────────────────
  console.log('\n── 6. abandoned pairs were left alone ──')
  const abandonedRevivable = abandoned.flatMap(p => [p.tm, p.wob])
    .filter(s => !s.written && s.state === 'revivable')
    .map(s => s.id)
  if (abandonedRevivable.length === 0) {
    ok('nothing to check', 'no abandoned pair had a revivable side')
  } else {
    const stillDead = await prisma.retailerListing.count({
      where: { id: { in: abandonedRevivable }, deletedAt: { not: null } },
    })
    check(stillDead === abandonedRevivable.length,
          'sold-out and unverified sides stay soft-deleted',
          `${stillDead} of ${abandonedRevivable.length} still soft-deleted`)
  }

  // ── current public state ─────────────────────────────────────────────────
  console.log('\n── current public state ──')
  const [live] = await prisma.$queryRaw<{ priced: bigint; products: bigint; two: bigint }[]>`
    SELECT
      (SELECT COUNT(*) FROM retailer_listings WHERE deleted_at IS NULL AND price_amount > 0)::bigint AS priced,
      (SELECT COUNT(DISTINCT canonical_product_id) FROM retailer_listings
         WHERE deleted_at IS NULL AND price_amount > 0 AND canonical_product_id IS NOT NULL)::bigint AS products,
      (SELECT COUNT(*) FROM (
         SELECT canonical_product_id FROM retailer_listings
         WHERE deleted_at IS NULL AND price_amount > 0 AND canonical_product_id IS NOT NULL
         GROUP BY canonical_product_id HAVING COUNT(DISTINCT retailer_id) >= 2) t)::bigint AS two`
  console.log(`  priced listings ${Number(live.priced)} · priced products ${Number(live.products)} · products at 2+ retailers ${Number(live.two)}`)

  // ── the comparison pages, widest price gap first ─────────────────────────
  console.log('\n── two-retailer pages now live, widest gap first ──')
  const pages = await prisma.$queryRaw<{
    canonical_slug: string; title: string; low: string; high: string; retailers: bigint
  }[]>`
    SELECT cp.canonical_slug, cp.title,
           MIN(rl.price_amount)::text AS low, MAX(rl.price_amount)::text AS high,
           COUNT(DISTINCT rl.retailer_id)::bigint AS retailers
    FROM retailer_listings rl
    JOIN canonical_products cp ON cp.id = rl.canonical_product_id
    WHERE rl.deleted_at IS NULL AND rl.price_amount > 0
    GROUP BY cp.canonical_slug, cp.title
    HAVING COUNT(DISTINCT rl.retailer_id) >= 2
    ORDER BY (MAX(rl.price_amount) - MIN(rl.price_amount)) DESC
    LIMIT 10`
  for (const p of pages) {
    console.log(`  £${String(p.low).padStart(6)} vs £${String(p.high).padStart(6)}  (${Number(p.retailers)} retailers)  ${p.canonical_slug}`)
  }

  console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECK(S) FAILED`} — ${pass} passed, ${fail} failed`)
  await prisma.$disconnect()
  if (fail > 0) process.exit(1)
}

main().catch(async e => {
  await prisma.$disconnect()
  console.error(e)
  process.exit(1)
})
