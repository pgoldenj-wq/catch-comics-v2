/**
 * b4-verify-recovery.ts — READ-ONLY verification of the B4 bounded recovery.
 *
 * Proves, without writing anything, that:
 *
 *   1. every row the write run published is active, priced and IN_STOCK;
 *   2. each published row has exactly ONE price_history observation from the
 *      recovery — no duplicates;
 *   3. a second run cannot touch them: the recovery's selection predicate
 *      (deleted_at = SWEEP_AT) no longer matches a single published row, so
 *      re-running creates no duplicate listing and no duplicate observation;
 *   4. nothing outside the 27 October sweep cohort moved.
 *
 * Zero writes. No HTTP.
 *
 *   npx dotenv -e <main>/.env.local -- npx tsx scripts/b4-verify-recovery.ts
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { join }         from 'node:path'

const prisma = new PrismaClient()
const SWEEP_AT  = new Date('2026-10-27T03:00:46.263Z')
const TM_DOMAIN = 'travellingman.com'
const n = (v: unknown) => Number(v)

interface ReportShape {
  outcomes: { id: string; slug: string; title: string; live: string | null; published: boolean }[]
}

async function main() {
  const report = JSON.parse(readFileSync(
    join(process.cwd(), 'launch', 'operations', 'b4-revive-write-latest.json'), 'utf8',
  )) as ReportShape
  const publishedIds = report.outcomes.filter(o => o.published).map(o => o.id)

  console.log(`published rows in the write report: ${publishedIds.length}`)
  if (publishedIds.length === 0) throw new Error('no published rows to verify')

  const fails: string[] = []
  const pass = (ok: boolean, label: string, detail: string) => {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`)
    if (!ok) fails.push(label)
  }

  console.log('\n── 1. every published row is active, priced and in stock ──')
  const rows = await prisma.retailerListing.findMany({
    where:  { id: { in: publishedIds } },
    select: {
      id: true, deletedAt: true, priceAmount: true, stockStatus: true,
      lastSeenAt: true, retailerUrl: true,
      canonicalProduct: { select: { canonicalSlug: true, title: true } },
    },
  })
  pass(rows.length === publishedIds.length, 'all rows present',
    `${rows.length} of ${publishedIds.length} found`)
  pass(rows.every(r => r.deletedAt === null), 'deleted_at cleared',
    `${rows.filter(r => r.deletedAt === null).length} active`)
  pass(rows.every(r => Number(r.priceAmount) > 0), 'priced above zero',
    `${rows.filter(r => Number(r.priceAmount) > 0).length} priced`)
  pass(rows.every(r => r.stockStatus === 'IN_STOCK'), 'stock status IN_STOCK',
    `${rows.filter(r => r.stockStatus === 'IN_STOCK').length} in stock`)

  console.log('\n── 2. exactly one observation per published row ──')
  const hist = await prisma.$queryRaw<{ retailer_listing_id: string; c: bigint }[]>`
    SELECT retailer_listing_id, COUNT(*)::bigint AS c
    FROM price_history
    WHERE retailer_listing_id = ANY(${publishedIds}::uuid[])
      AND recorded_at >= ${new Date(Date.now() - 6 * 60 * 60 * 1000)}
    GROUP BY retailer_listing_id`
  const dupes = hist.filter(h => n(h.c) !== 1)
  pass(hist.length === publishedIds.length, 'one observation row each',
    `${hist.length} of ${publishedIds.length} rows have a recovery observation`)
  pass(dupes.length === 0, 'no duplicate observations',
    dupes.length === 0 ? 'every row has exactly 1' : `${dupes.length} rows have more than one`)

  console.log('\n── 3. a second run cannot reach them (idempotency) ──')
  const stillSelectable = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c
    FROM retailer_listings rl JOIN retailers r ON r.id = rl.retailer_id
    WHERE r.domain = ${TM_DOMAIN}
      AND rl.deleted_at = ${SWEEP_AT}
      AND rl.id = ANY(${publishedIds}::uuid[])`
  pass(n(stillSelectable[0].c) === 0, 'published rows no longer match the selection',
    `${n(stillSelectable[0].c)} of ${publishedIds.length} still match deleted_at = SWEEP_AT`)

  console.log('\n── 4. nothing outside the sweep cohort moved ──')
  const [cohort] = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c
    FROM retailer_listings rl JOIN retailers r ON r.id = rl.retailer_id
    WHERE r.domain = ${TM_DOMAIN} AND rl.deleted_at = ${SWEEP_AT}`
  pass(n(cohort.c) === 2246 - publishedIds.length, 'cohort reduced by exactly the published count',
    `${n(cohort.c)} remain (expected ${2246 - publishedIds.length})`)

  const [otherCohorts] = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c
    FROM retailer_listings rl JOIN retailers r ON r.id = rl.retailer_id
    WHERE r.domain = ${TM_DOMAIN}
      AND rl.deleted_at IS NOT NULL
      AND rl.deleted_at <> ${SWEEP_AT}`
  pass(n(otherCohorts.c) === 25764 - 2246, 'unrelated deletions untouched',
    `${n(otherCohorts.c)} rows still deleted in other cohorts (expected ${25764 - 2246})`)

  console.log('\n── current public state ──')
  const [priced] = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c FROM retailer_listings
    WHERE deleted_at IS NULL AND price_amount > 0`
  const [two] = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c FROM (
      SELECT canonical_product_id FROM retailer_listings
      WHERE deleted_at IS NULL AND price_amount > 0 AND canonical_product_id IS NOT NULL
      GROUP BY canonical_product_id HAVING COUNT(DISTINCT retailer_id) >= 2) t`
  console.log(`  priced listings ${n(priced.c)} · products at 2+ retailers ${n(two.c)}`)

  console.log('\n── live offers now on the site ──')
  for (const r of rows.sort((a, b) => Number(b.priceAmount) - Number(a.priceAmount))) {
    console.log(`  £${String(r.priceAmount).padStart(6)}  ${r.canonicalProduct?.canonicalSlug}`)
  }

  await prisma.$disconnect()
  console.log(`\n${fails.length === 0 ? 'ALL CHECKS PASSED' : `FAILED: ${fails.join(', ')}`}`)
  if (fails.length > 0) process.exit(1)
}

main().catch(async e => {
  await prisma.$disconnect()
  console.error(e)
  process.exit(1)
})
