/**
 * b4-scope-second-feed.ts — READ-ONLY.
 *
 * Scopes the remaining half of blocker B4: getting a SECOND priced retailer
 * onto the same editions, which is what "price comparison" actually requires.
 * Reviving Travelling Man restored prices; it did not restore comparison.
 *
 * Answers, with measurements rather than assumptions:
 *   1. which retailers the existing code can actually verify or refresh;
 *   2. how many of the 10 restored offers could gain a second price, per
 *      candidate retailer — the only number that moves "products at 2+";
 *   3. the same for the whole remaining 27 October cohort, to size the ceiling;
 *   4. whether the Bookshop stubs are reachable without new infrastructure.
 *
 * Zero writes. No HTTP. Reports whether an API key is PRESENT, never its value.
 *
 *   npx dotenv -e <main>/.env.local -- npx tsx scripts/b4-scope-second-feed.ts
 */
import { PrismaClient }             from '@prisma/client'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join }            from 'node:path'

const prisma = new PrismaClient()
const SWEEP_AT = new Date('2026-10-27T03:00:46.263Z')
const n = (v: unknown) => Number(v)

async function main() {
  const out: Record<string, unknown> = {
    runAt: new Date().toISOString(),
    mode:  'READ-ONLY (zero writes, zero HTTP)',
  }

  // ── Credentials: presence only, never values ──────────────────────────────
  out.credentials = {
    BOOKSHOP_API_KEY:  Boolean(process.env.BOOKSHOP_API_KEY),
    SLACK_WEBHOOK_URL: Boolean(process.env.SLACK_WEBHOOK_URL),
    EBAY_APP_ID:       Boolean(process.env.EBAY_APP_ID ?? process.env.EBAY_CLIENT_ID),
    AWIN_API_TOKEN:    Boolean(process.env.AWIN_API_TOKEN),
  }

  // ── 1. What can the existing code actually drive? ─────────────────────────
  const retailers = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT r.name, r.domain, r.platform::text AS platform, r.is_active,
           (r.sync_config->>'scheduled_sync_disabled') AS sync_disabled,
           COUNT(rl.id)::bigint                                            AS total,
           COUNT(rl.id) FILTER (WHERE rl.deleted_at IS NULL)::bigint       AS active,
           COUNT(rl.id) FILTER (WHERE rl.deleted_at IS NULL
                                  AND rl.price_amount > 0)::bigint         AS active_priced,
           MAX(rl.last_seen_at)                                            AS max_last_seen
    FROM retailers r LEFT JOIN retailer_listings rl ON rl.retailer_id = r.id
    GROUP BY r.id, r.name, r.domain, r.platform, r.is_active, r.sync_config
    HAVING COUNT(rl.id) > 0
    ORDER BY COUNT(rl.id) FILTER (WHERE rl.deleted_at IS NULL) DESC, COUNT(rl.id) DESC`
  out.retailers = retailers.map(r => ({
    ...r, total: n(r.total), active: n(r.active), active_priced: n(r.active_priced),
  }))

  // ── 2. The 10 restored TM offers: who else holds the same edition? ────────
  const revived = await prisma.$queryRaw<{ canonical_product_id: string }[]>`
    SELECT rl.canonical_product_id
    FROM retailer_listings rl JOIN retailers r ON r.id = rl.retailer_id
    WHERE r.domain = 'travellingman.com'
      AND rl.deleted_at IS NULL AND rl.price_amount > 0
      AND rl.canonical_product_id IS NOT NULL`
  const revivedIds = revived.map(r => r.canonical_product_id)
  out.restoredOfferCount = revivedIds.length

  out.secondPriceReachableForRestored = (await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT r.name, r.domain, r.platform::text AS platform,
           COUNT(*)::bigint                                             AS rows_held,
           COUNT(*) FILTER (WHERE o.deleted_at IS NULL)::bigint         AS rows_active,
           COUNT(*) FILTER (WHERE o.price_amount > 0)::bigint           AS rows_with_a_stored_price,
           COUNT(DISTINCT o.canonical_product_id)::bigint               AS editions_covered,
           MIN(o.deleted_at)                                            AS earliest_deletion,
           MAX(o.deleted_at)                                            AS latest_deletion
    FROM retailer_listings o JOIN retailers r ON r.id = o.retailer_id
    WHERE o.canonical_product_id = ANY(${revivedIds}::uuid[])
      AND r.domain <> 'travellingman.com'
    GROUP BY r.id, r.name, r.domain, r.platform
    ORDER BY COUNT(DISTINCT o.canonical_product_id) DESC`)
    .map(r => ({
      ...r, rows_held: n(r.rows_held), rows_active: n(r.rows_active),
      rows_with_a_stored_price: n(r.rows_with_a_stored_price),
      editions_covered: n(r.editions_covered),
    }))

  // ── 3. Ceiling across the whole remaining 27 October cohort ───────────────
  out.ceilingAcrossRemainingCohort = (await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT r.name, r.platform::text AS platform,
           COUNT(DISTINCT tm.canonical_product_id)::bigint AS editions_shared,
           COUNT(*) FILTER (WHERE o.price_amount > 0)::bigint AS rows_with_a_stored_price,
           COUNT(*) FILTER (WHERE o.deleted_at IS NULL)::bigint AS rows_active
    FROM retailer_listings tm
    JOIN retailers tmr ON tmr.id = tm.retailer_id AND tmr.domain = 'travellingman.com'
    JOIN retailer_listings o ON o.canonical_product_id = tm.canonical_product_id
                            AND o.retailer_id <> tm.retailer_id
    JOIN retailers r ON r.id = o.retailer_id
    WHERE tm.deleted_at = ${SWEEP_AT} AND tm.canonical_product_id IS NOT NULL
    GROUP BY r.id, r.name, r.platform
    ORDER BY COUNT(DISTINCT tm.canonical_product_id) DESC`)
    .map(r => ({
      ...r, editions_shared: n(r.editions_shared),
      rows_with_a_stored_price: n(r.rows_with_a_stored_price),
      rows_active: n(r.rows_active),
    }))

  // ── 4. The Bookshop stubs: active, fresh, and zero-priced ─────────────────
  out.bookshopStubs = (await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT r.name, r.domain,
           COUNT(*) FILTER (WHERE rl.deleted_at IS NULL)::bigint                        AS active,
           COUNT(*) FILTER (WHERE rl.deleted_at IS NULL AND rl.price_amount = 0)::bigint AS active_zero_priced,
           COUNT(*) FILTER (WHERE rl.deleted_at IS NULL AND rl.price_amount > 0)::bigint AS active_priced,
           COUNT(*) FILTER (WHERE rl.deleted_at IS NULL
                              AND rl.canonical_product_id IS NOT NULL)::bigint          AS active_matched,
           MAX(rl.last_seen_at)                                                          AS max_last_seen,
           MIN(rl.last_seen_at) FILTER (WHERE rl.deleted_at IS NULL)                     AS min_last_seen_active
    FROM retailer_listings rl JOIN retailers r ON r.id = rl.retailer_id
    WHERE r.domain IN ('uk.bookshop.org', 'bookshop.org')
    GROUP BY r.id, r.name, r.domain`)
    .map(r => ({
      ...r, active: n(r.active), active_zero_priced: n(r.active_zero_priced),
      active_priced: n(r.active_priced), active_matched: n(r.active_matched),
    }))

  // Of the ACTIVE Bookshop stubs, how many sit on an edition Travelling Man
  // could also price? That is the realistic "products at 2+ retailers" figure
  // if the stubs were promoted to real prices.
  const overlap = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(DISTINCT b.canonical_product_id)::bigint AS c
    FROM retailer_listings b JOIN retailers br ON br.id = b.retailer_id
    JOIN retailer_listings tm ON tm.canonical_product_id = b.canonical_product_id
    JOIN retailers tmr ON tmr.id = tm.retailer_id AND tmr.domain = 'travellingman.com'
    WHERE br.domain IN ('uk.bookshop.org', 'bookshop.org')
      AND b.deleted_at IS NULL
      AND (tm.deleted_at = ${SWEEP_AT} OR tm.deleted_at IS NULL)`
  const overlapRestored = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(DISTINCT b.canonical_product_id)::bigint AS c
    FROM retailer_listings b JOIN retailers br ON br.id = b.retailer_id
    WHERE br.domain IN ('uk.bookshop.org', 'bookshop.org')
      AND b.deleted_at IS NULL
      AND b.canonical_product_id = ANY(${revivedIds}::uuid[])`
  out.bookshopOverlap = {
    activeStubsOnRecoverableTmEditions: n(overlap[0].c),
    activeStubsOnTheRestoredTen:        n(overlapRestored[0].c),
  }

  // ── 5. World of Books: its own cohorts, and the trusted subset size ───────
  out.wobCohorts = (await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT rl.deleted_at, COUNT(*)::bigint AS rows,
           COUNT(*) FILTER (WHERE rl.canonical_product_id IS NOT NULL)::bigint AS matched
    FROM retailer_listings rl JOIN retailers r ON r.id = rl.retailer_id
    WHERE r.domain = 'worldofbooks.com' AND rl.deleted_at IS NOT NULL
    GROUP BY rl.deleted_at ORDER BY COUNT(*) DESC LIMIT 5`)
    .map(r => ({ ...r, rows: n(r.rows), matched: n(r.matched) }))

  await prisma.$disconnect()

  const p = join(process.cwd(), 'launch', 'operations', 'b4-second-feed-scope.json')
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(out, null, 2))

  console.log('═══ credentials present (presence only) ═══')
  for (const [k, v] of Object.entries(out.credentials as Record<string, boolean>)) {
    console.log(`  ${k.padEnd(20)} ${v ? 'SET' : 'not set'}`)
  }

  console.log('\n═══ retailers, by active rows ═══')
  for (const r of out.retailers as Record<string, unknown>[]) {
    console.log(`  ${String(r.name).padEnd(20)} ${String(r.platform).padEnd(16)} active ${String(r.active).padStart(6)} · priced ${String(r.active_priced).padStart(5)} · total ${String(r.total).padStart(7)} · sync_disabled ${r.sync_disabled ?? '-'}`)
  }

  console.log(`\n═══ a second price for the ${out.restoredOfferCount} restored offers ═══`)
  for (const r of out.secondPriceReachableForRestored as Record<string, unknown>[]) {
    console.log(`  ${String(r.name).padEnd(20)} ${String(r.platform).padEnd(16)} editions ${String(r.editions_covered).padStart(3)} · active ${String(r.rows_active).padStart(3)} · stored price ${String(r.rows_with_a_stored_price).padStart(3)}`)
  }

  console.log('\n═══ ceiling across the remaining 2,236-row cohort ═══')
  for (const r of out.ceilingAcrossRemainingCohort as Record<string, unknown>[]) {
    console.log(`  ${String(r.name).padEnd(20)} ${String(r.platform).padEnd(16)} editions shared ${String(r.editions_shared).padStart(5)} · priced rows ${String(r.rows_with_a_stored_price).padStart(5)} · active ${r.rows_active}`)
  }

  console.log('\n═══ Bookshop stubs ═══')
  for (const r of out.bookshopStubs as Record<string, unknown>[]) {
    console.log(`  ${String(r.domain).padEnd(18)} active ${r.active} · zero-priced ${r.active_zero_priced} · priced ${r.active_priced} · matched ${r.active_matched}`)
    console.log(`  ${' '.repeat(18)} last seen ${r.max_last_seen} · oldest active ${r.min_last_seen_active}`)
  }
  const bo = out.bookshopOverlap as Record<string, number>
  console.log(`  active stubs on a recoverable TM edition : ${bo.activeStubsOnRecoverableTmEditions}`)
  console.log(`  active stubs on one of the restored ten  : ${bo.activeStubsOnTheRestoredTen}`)

  console.log('\n═══ World of Books cohorts ═══')
  for (const r of out.wobCohorts as Record<string, unknown>[]) {
    console.log(`  ${r.deleted_at}  ${String(r.rows).padStart(6)} rows · ${r.matched} matched to a product`)
  }

  console.log(`\nwritten: ${p}`)
}

main().catch(async e => {
  await prisma.$disconnect()
  console.error(e)
  process.exit(1)
})
