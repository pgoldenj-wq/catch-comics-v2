/**
 * b4-baseline-and-candidates.ts — READ-ONLY.
 *
 * Captures the production baseline for launch-plan blocker B4 and inspects the
 * Travelling Man deletion cohorts, so a bounded recovery can target exactly the
 * rows the 27 October retention sweep expired and nothing else.
 *
 * Zero writes. No HTTP. No Inngest. Nothing but SELECTs.
 *
 *   npx dotenv -e <main-checkout>/.env.local -- npx tsx scripts/b4-baseline-and-candidates.ts
 */
import { PrismaClient }             from '@prisma/client'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join }            from 'node:path'

const prisma = new PrismaClient()
const n = (v: unknown) => Number(v)

async function main() {
  const out: Record<string, unknown> = {
    runAt: new Date().toISOString(),
    mode:  'READ-ONLY (zero writes, zero HTTP)',
  }

  // ── Baseline: the three numbers B4's "done" condition names ───────────────
  const priced = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c FROM retailer_listings
    WHERE deleted_at IS NULL AND price_amount > 0`

  const pricedProducts = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(DISTINCT canonical_product_id)::bigint AS c FROM retailer_listings
    WHERE deleted_at IS NULL AND price_amount > 0 AND canonical_product_id IS NOT NULL`

  const twoRetailers = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c FROM (
      SELECT canonical_product_id FROM retailer_listings
      WHERE deleted_at IS NULL AND price_amount > 0 AND canonical_product_id IS NOT NULL
      GROUP BY canonical_product_id HAVING COUNT(DISTINCT retailer_id) >= 2
    ) t`

  const anyActive = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c FROM retailer_listings WHERE deleted_at IS NULL`

  out.baseline = {
    pricedListings:         n(priced[0].c),
    pricedProducts:         n(pricedProducts[0].c),
    productsAtTwoRetailers: n(twoRetailers[0].c),
    activeListingsAnyPrice: n(anyActive[0].c),
  }

  // ── Per-retailer state ────────────────────────────────────────────────────
  const retailers = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT r.name, r.domain, r.is_active,
           (r.sync_config->>'scheduled_sync_disabled') AS scheduled_sync_disabled,
           r.last_synced_at,
           COUNT(rl.id)::bigint                                      AS total,
           COUNT(rl.id) FILTER (WHERE rl.deleted_at IS NULL)::bigint AS active,
           COUNT(rl.id) FILTER (WHERE rl.deleted_at IS NULL
                                  AND rl.price_amount > 0)::bigint   AS active_priced,
           MAX(rl.last_seen_at)                                      AS max_last_seen
    FROM retailers r
    LEFT JOIN retailer_listings rl ON rl.retailer_id = r.id
    GROUP BY r.id, r.name, r.domain, r.is_active, r.sync_config, r.last_synced_at
    HAVING COUNT(rl.id) > 0
    ORDER BY COUNT(rl.id) DESC`
  out.retailers = retailers.map(r => ({
    ...r,
    total: n(r.total), active: n(r.active), active_priced: n(r.active_priced),
  }))

  // ── Which TM deletions belong to which sweep ──────────────────────────────
  // The 27 Oct sweep is one transaction, so its rows share one exact timestamp.
  // Anything else is an unrelated deletion and is out of scope by construction.
  const cohorts = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT rl.deleted_at, COUNT(*)::bigint AS rows
    FROM retailer_listings rl JOIN retailers r ON r.id = rl.retailer_id
    WHERE r.domain = 'travellingman.com' AND rl.deleted_at IS NOT NULL
    GROUP BY rl.deleted_at
    ORDER BY COUNT(*) DESC
    LIMIT 12`
  out.tmDeletionCohorts = cohorts.map(r => ({ ...r, rows: n(r.rows) }))

  await prisma.$disconnect()

  const p = join(process.cwd(), 'launch', 'operations', 'b4-baseline-latest.json')
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2))
  console.log(`\nwritten: ${p}`)
}

main().catch(async e => {
  await prisma.$disconnect()
  console.error(e)
  process.exit(1)
})
