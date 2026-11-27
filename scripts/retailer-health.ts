/**
 * retailer-health.ts — READ-ONLY. One row per retailer answering the only
 * question that matters operationally: is this source still working, and if
 * not, which kind of not-working is it?
 *
 * The 2026-09/10 outage was invisible because "nothing was due", "feed checked
 * and unchanged", "deliberately excluded" and "silently broken" all looked
 * identical from the outside — a retailer with no recent write. They are
 * different diagnoses with different responses, so this separates them:
 *
 *   FRESH        a new price observation was published recently
 *   CHECKED      the source was re-read, prices were unchanged (not a fault)
 *   NOTHING_DUE  inside its refresh interval; nothing should have happened
 *   BLOCKED      deliberately excluded — scheduled_sync_disabled or SKIP_PLATFORMS
 *   LIVE_LOOKUP  no stored prices by design; queried per request (eBay)
 *   FAILED       last attempt errored, or attempts since last success
 *   STALE        no fresh observation inside the staleness window
 *
 * STRICTLY READ-ONLY. Run: npm run retailers:health
 */

import { PrismaClient } from '@prisma/client'
import { SKIP_PLATFORMS, DEFAULT_REFRESH_HOURS } from '../lib/sync/dispatch'
import { SHOPIFY_VERIFY_DOMAINS } from '../lib/inngest/functions/offer-refresh'

const prisma = new PrismaClient()
const SWEEP_DAYS = 30
const STALE_HOURS = 48

const iso = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 16).replace('T', ' ') : '—'
const n = (v: unknown) => Number(v ?? 0)
const hrs = (a: Date, b: Date) => (a.getTime() - b.getTime()) / 3_600_000

async function main() {
  const now = new Date()
  // offer_refresh runs at 02:00 UTC daily — the next one, for "next due".
  const next0200 = new Date(now)
  next0200.setUTCHours(2, 0, 0, 0)
  if (next0200 <= now) next0200.setUTCDate(next0200.getUTCDate() + 1)

  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT r.domain,
           r.platform::text AS platform,
           r.is_active      AS "isActive",
           r.last_synced_at AS "lastSyncedAt",
           COALESCE((r.sync_config->'scheduled_sync_disabled') = 'true'::jsonb, false) AS disabled,
           CASE WHEN jsonb_typeof(r.sync_config->'refreshIntervalHours') = 'number'
                THEN (r.sync_config->>'refreshIntervalHours')::int END AS "intervalHours",
           COUNT(rl.id)::int        AS priced,
           MIN(rl.last_seen_at)     AS "oldestSeen",
           MAX(rl.last_seen_at)     AS "newestSeen",
           ph.newest_observation    AS "newestObservation",
           la.started_at            AS "lastAttemptAt",
           la.status                AS "lastAttemptStatus",
           la.error_summary         AS "lastError"
    FROM retailers r
    LEFT JOIN retailer_listings rl
      ON rl.retailer_id = r.id AND rl.deleted_at IS NULL AND rl.price_amount > 0
    LEFT JOIN LATERAL (
      SELECT MAX(h.recorded_at) AS newest_observation
      FROM price_history h
      JOIN retailer_listings l ON l.id = h.retailer_listing_id
      WHERE l.retailer_id = r.id
    ) ph ON true
    LEFT JOIN LATERAL (
      SELECT s.started_at, s.status, s.error_summary
      FROM sync_logs s WHERE s.retailer_id = r.id
      ORDER BY s.started_at DESC LIMIT 1
    ) la ON true
    WHERE r.is_active = true
    GROUP BY r.id, r.domain, r.platform, r.is_active, r.last_synced_at, r.sync_config,
             ph.newest_observation, la.started_at, la.status, la.error_summary
    ORDER BY COUNT(rl.id) DESC, r.domain
  `

  const out: Array<Record<string, string>> = []
  for (const r of rows) {
    const platform = String(r.platform)
    const priced   = n(r.priced)
    const disabled = r.disabled === true
    const skip     = SKIP_PLATFORMS.has(platform)
    const newestSeen = r.newestSeen as Date | null
    const oldestSeen = r.oldestSeen as Date | null
    const lastSynced = r.lastSyncedAt as Date | null
    const interval   = r.intervalHours === null || r.intervalHours === undefined
      ? (DEFAULT_REFRESH_HOURS[platform] ?? 24) : n(r.intervalHours)

    const nextDue = lastSynced ? new Date(lastSynced.getTime() + interval * 3_600_000) : null
    const expiry  = oldestSeen ? new Date(oldestSeen.getTime() + SWEEP_DAYS * 864e5) : null

    // Order matters: a deliberate exclusion is not a failure, and a live-lookup
    // source having no stored rows is not staleness.
    const verifiedDaily = SHOPIFY_VERIFY_DOMAINS.includes(String(r.domain))
    const isStale = !!newestSeen && hrs(now, newestSeen) > STALE_HOURS
    const isFresh = !!newestSeen && hrs(now, newestSeen) < 12

    let state: string
    if (platform === 'EBAY')                   state = 'LIVE_LOOKUP'
    else if (r.lastAttemptStatus === 'error')  state = 'FAILED'
    // Excluded from the hourly cron ON PURPOSE because offer_refresh covers it.
    // That is coverage, not a block — but it is held to the same staleness bar,
    // otherwise the two retailers behind B4 could rot unflagged all over again.
    else if (verifiedDaily)                    state = isStale ? 'STALE' : isFresh ? 'FRESH' : 'VERIFIED_DAILY'
    else if (disabled || skip)                 state = 'BLOCKED'
    else if (!newestSeen)                      state = 'NO DATA'
    else if (isStale)                          state = 'STALE'
    else if (isFresh)                          state = 'FRESH'
    else if (nextDue && nextDue > now)         state = 'NOTHING_DUE'
    else                                       state = 'CHECKED'

    out.push({
      domain:   String(r.domain),
      platform,
      state,
      priced:   String(priced),
      check:    iso(newestSeen),
      obs:      iso(r.newestObservation as Date | null),
      due:      verifiedDaily          ? iso(next0200)
              : state === 'BLOCKED'    ? 'manual/CLI'
              : state === 'LIVE_LOOKUP' ? 'per request'
              : iso(nextDue),
      expiry:   iso(expiry),
      // eBay is also in SKIP_PLATFORMS, but for the opposite reason to the
      // affiliate-only retailers: it has LIVE prices fetched per request, so
      // it is skipped by the feed sync because storing them would be wrong.
      note:     platform === 'EBAY' ? 'live Browse API lookup per shopper request — no stored rows by design'
              : verifiedDaily ? 'excluded from the hourly cron — covered by offer_refresh, daily 02:00 UTC'
              : disabled      ? 'scheduled_sync_disabled — NO automated cover'
              : skip          ? `${platform} in SKIP_PLATFORMS — affiliate link only, no price feed`
              : '',
    })
  }

  console.log('\n## Retailer health — what each source is actually doing\n')
  console.log('   retailer              state        priced  last source check  last observation   next due          earliest expiry')
  for (const o of out) {
    console.log(
      '   ' + o.domain.padEnd(21) + o.state.padEnd(13) +
      o.priced.padStart(6) + '  ' + o.check.padEnd(18) + o.obs.padEnd(18) +
      o.due.padEnd(18) + o.expiry,
    )
    if (o.note) console.log(`        └─ ${o.note}`)
  }

  const live = out.filter(o => ['FRESH', 'CHECKED', 'NOTHING_DUE', 'VERIFIED_DAILY'].includes(o.state))
  const bad  = out.filter(o => ['STALE', 'FAILED', 'NO DATA'].includes(o.state))
  console.log(`\n   healthy: ${live.length} · deliberate: ${out.filter(o => o.state === 'BLOCKED' || o.state === 'LIVE_LOOKUP').length} · NEEDS ATTENTION: ${bad.length}`)
  if (bad.length) for (const b of bad) console.log(`     ${b.state}  ${b.domain} — last observation ${b.obs}`)

  await prisma.$disconnect()
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
