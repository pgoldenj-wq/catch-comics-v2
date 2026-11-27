/**
 * diagnose-scheduler-tick.ts — READ-ONLY. Why did the hourly scheduler not
 * produce a run?
 *
 * Written 2026-11-27 after the 01:00 tick left no new sync_logs row for
 * scholastic.co.uk despite its refresh interval having been brought forward to
 * 1 hour. Three explanations have to be told apart, and only one of them is a
 * code defect:
 *
 *   A. the cron never executed in Inngest;
 *   B. it executed and the Cost Guard refused it (nonessential class);
 *   C. it executed, and its own SQL + predicate found nothing due.
 *
 * (B) and (C) are distinguishable from stored state, so this reads it rather
 * than guessing. The Cost Guard records every refusal both as a 'job-refused'
 * event and as an entry in state.activeRestrictions, so a refusal cannot
 * happen silently.
 *
 * It runs the cron's OWN SQL verbatim — not the variant in check-sync-due.ts,
 * which filters consecutiveFailures on status='error' where the cron counts
 * every attempt. Both decisions are printed so any disagreement is visible.
 *
 * Writes nothing. No HTTP except the Cost Guard state read from KV.
 *
 *   npx dotenv -e <main>/.env.local -- npx tsx scripts/diagnose-scheduler-tick.ts
 */
import { PrismaClient } from '@prisma/client'
import {
  isDueForScheduledSync, SKIP_PLATFORMS, isScheduledSyncDisabled,
  refreshIntervalHours, failureCooldownMs, RUN_LEASE_MS,
} from '@/lib/sync/dispatch'
import { getState, getEvents, storeMode } from '@/lib/costguard/store'

const prisma = new PrismaClient()
const iso = (d: Date | null | undefined) => (d ? d.toISOString().replace('T', ' ').slice(0, 19) : '—')
const usd = (n: number | null | undefined) => (typeof n === 'number' ? `$${n.toFixed(2)}` : String(n))

async function main() {
  const now = Date.now()
  console.log(`## Diagnosis at ${new Date(now).toISOString()}\n`)

  // ── 1. Cost Guard: did the gate refuse the cron? ──────────────────────────
  console.log('## Cost Guard — the gate in front of the whole hourly pipeline\n')
  const mode = storeMode()
  console.log(`  store mode  ${mode}${mode === 'file' ? '  (LOCAL file store — this machine may not see production state)' : ''}`)
  const st = await getState()
  if (!st) {
    console.log('  state       (none visible from here) — the gate would read AMBER')
  } else {
    const ageH = (now - Date.parse(st.updatedAt)) / 3_600_000
    console.log(`  state       ${st.state}   updated ${st.updatedAt} (${ageH.toFixed(1)}h ago)${ageH > 26 ? '  STALE -> gate reads at least AMBER' : ''}`)
    console.log(`  reasons     ${st.reasons.length ? st.reasons.join(' | ') : '(none)'}`)
    console.log(`  lockdown latched ${st.lockdownLatched}`)
    console.log(`  spend       variable MTD ${usd(st.totals.variableMtdUsd)} · projected month ${usd(st.totals.projectedMonthUsd)} · burn ${usd(st.totals.burnUsdPerDay)}/day`)
    console.log(`  last collection ${st.lastCollectionAt ?? 'never'}`)
    const mine = st.activeRestrictions.filter(r => /sync/.test(r.operation))
    console.log(`  restrictions on sync operations: ${mine.length ? '' : 'NONE — the gate has never refused a sync job'}`)
    for (const r of mine) console.log(`    ${r.operation.padEnd(36)} refused ${r.count}x · last ${r.lastAt}`)
  }

  const events = await getEvents().catch(() => [])
  const refusals = events.filter(e => e.kind === 'job-refused' && /sync/.test(JSON.stringify(e.detail ?? {})))
  console.log(`  'job-refused' events mentioning sync: ${refusals.length}`)
  for (const e of [...refusals].reverse().slice(0, 6)) console.log(`    ${e.at} ${e.message}`)
  console.log('')

  // ── 2. The cron's own SQL, verbatim ──────────────────────────────────────
  console.log("## What the cron's OWN query + predicate decide right now\n")
  const rows = await prisma.$queryRaw<Array<{
    id: string; domain: string; platform: string; lastSyncedAt: Date | null
    scheduledSyncDisabled: boolean; refreshIntervalHours: number | null
    lastAttemptAt: Date | null; lastAttemptStatus: string | null; consecutiveFailures: number
  }>>`
    SELECT r.id, r.domain, r.platform, r.last_synced_at AS "lastSyncedAt",
           COALESCE((r.sync_config->'scheduled_sync_disabled') = 'true'::jsonb, false) AS "scheduledSyncDisabled",
           CASE WHEN jsonb_typeof(r.sync_config->'refreshIntervalHours') = 'number'
                THEN (r.sync_config->>'refreshIntervalHours')::int END AS "refreshIntervalHours",
           la.started_at AS "lastAttemptAt", la.status AS "lastAttemptStatus",
           COALESCE(cf.n, 0)::int AS "consecutiveFailures"
    FROM retailers r
    LEFT JOIN LATERAL (
      SELECT s.started_at, s.status FROM sync_logs s
      WHERE s.retailer_id = r.id ORDER BY s.started_at DESC LIMIT 1
    ) la ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS n FROM sync_logs s
      WHERE s.retailer_id = r.id
        AND s.started_at > COALESCE(r.last_synced_at, '-infinity'::timestamptz)
    ) cf ON true
    WHERE r.is_active = true
    ORDER BY r.domain`

  let dueCount = 0
  for (const r of rows) {
    const cfg = {
      ...(r.scheduledSyncDisabled ? { scheduled_sync_disabled: true } : {}),
      ...(r.refreshIntervalHours !== null ? { refreshIntervalHours: r.refreshIntervalHours } : {}),
    }
    const shape = {
      platform: r.platform, lastSyncedAt: r.lastSyncedAt, syncConfig: cfg,
      lastAttemptAt: r.lastAttemptAt, lastAttemptStatus: r.lastAttemptStatus,
      consecutiveFailures: r.consecutiveFailures,
    }
    const due = isDueForScheduledSync(shape, now)
    if (due) dueCount++

    // Same shape, but with the error-only failure count check-sync-due.ts uses.
    const errOnly = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n FROM sync_logs s
      WHERE s.retailer_id = ${r.id}::uuid AND s.status = 'error'
        AND s.started_at > COALESCE((SELECT last_synced_at FROM retailers WHERE id = ${r.id}::uuid), '-infinity'::timestamptz)`
    const dueMyVariant = isDueForScheduledSync({ ...shape, consecutiveFailures: Number(errOnly[0].n) }, now)

    const sinceAttemptH = (now - (r.lastAttemptAt?.getTime() ?? 0)) / 3_600_000
    let why: string
    if (SKIP_PLATFORMS.has(r.platform)) why = `platform ${r.platform} in SKIP_PLATFORMS`
    else if (isScheduledSyncDisabled(cfg)) why = 'scheduled_sync_disabled=true'
    else if (r.lastAttemptStatus === 'running' && now - (r.lastAttemptAt?.getTime() ?? 0) < RUN_LEASE_MS)
      why = 'in-flight lease held by a running sync_log'
    else if (r.consecutiveFailures > 0 && now - (r.lastAttemptAt?.getTime() ?? 0) < failureCooldownMs(r.consecutiveFailures))
      why = `failure cooldown: ${r.consecutiveFailures} attempts since last success -> ${failureCooldownMs(r.consecutiveFailures) / 3_600_000}h, ${sinceAttemptH.toFixed(1)}h elapsed`
    else if (!due) why = `inside refresh interval (${refreshIntervalHours(cfg, r.platform)}h, last synced ${iso(r.lastSyncedAt)})`
    else why = `DUE — interval ${refreshIntervalHours(cfg, r.platform)}h elapsed since ${iso(r.lastSyncedAt)}`

    const flag = due !== dueMyVariant ? '  <-- retailers:due DISAGREES' : ''
    console.log(`  ${due ? 'DUE  ' : 'skip '} ${r.domain.padEnd(22)} ${r.platform.padEnd(17)} attempts-since-success ${String(r.consecutiveFailures).padStart(3)} (errors ${String(Number(errOnly[0].n)).padStart(3)}) · ${why}${flag}`)
  }
  console.log(`\n  cron would enqueue ${dueCount} retailer(s) on the next tick`)

  // ── 3. sync_logs for the three connected feeds ────────────────────────────
  console.log('\n## sync_logs for the connected Awin feeds (most recent 30)\n')
  const logs = await prisma.$queryRaw<{
    domain: string; status: string; started_at: Date; finished_at: Date | null
    touched: number | null; error: string | null
  }[]>`
    SELECT r.domain, s.status, s.started_at, s.finished_at,
           s.listings_updated AS touched, LEFT(COALESCE(s.error_summary, ''), 90) AS error
    FROM sync_logs s JOIN retailers r ON r.id = s.retailer_id
    WHERE r.domain IN ('scholastic.co.uk', 'waterstones.com', 'letsbuybooks.com')
    ORDER BY s.started_at DESC LIMIT 30`
  if (logs.length === 0) console.log('  (no sync_logs rows at all for these three)')
  for (const l of logs) {
    console.log(`  ${l.domain.padEnd(18)} ${l.status.padEnd(8)} ${iso(l.started_at)} -> ${iso(l.finished_at)} · ${l.touched ?? 0} touched${l.error ? ' · ' + l.error : ''}`)
  }

  // ── 4. Did ANY sync_log row appear recently, for any retailer? ────────────
  const [recent] = await prisma.$queryRaw<{ n: bigint; newest: Date | null }[]>`
    SELECT COUNT(*)::bigint AS n, MAX(started_at) AS newest
    FROM sync_logs WHERE started_at > now() - interval '48 hours'`
  console.log(`\n  sync_logs rows in the last 48h, ALL retailers: ${Number(recent.n)} (newest ${iso(recent.newest)})`)

  // ── 5. job_runs: which jobs record a run at all? ─────────────────────────
  const jr = await prisma.$queryRaw<{ job_name: string; n: bigint; newest: Date | null }[]>`
    SELECT job_name, COUNT(*)::bigint AS n, MAX(started_at) AS newest
    FROM job_runs GROUP BY job_name ORDER BY job_name`
  console.log('\n## job_runs — which jobs record their own execution\n')
  for (const j of jr) console.log(`  ${j.job_name.padEnd(34)} ${String(Number(j.n)).padStart(5)} runs · newest ${iso(j.newest)}`)
  const sawScheduler = jr.some(j => j.job_name === 'sync_retailer.scheduled')
  console.log(sawScheduler
    ? '  NOTE: sync_retailer.scheduled records every tick, including quiet ones — a gap in it IS missed ticks.'
    : '  NOTE: sync_retailer.scheduled rows begin only after the 2026-11-27 deploy. Before that the cron wrote\n'
    + '        nothing at all, so its absence above is not evidence either way for any earlier period.')

  // ── 6. What a stalled refresh costs, and when ────────────────────────────
  // cleanup-stale (cron 0 3 * * *) runs both passes against last_seen_at at
  // 30 days: pass 1 flips to OUT_OF_STOCK, pass 2 soft-deletes. So every
  // priced row has a dated expiry, and a scheduler that never runs does not
  // merely freeze prices — it hands them to the sweep.
  console.log('\n## Expiry — when the 30-day sweep takes these offers\n')
  const exp = await prisma.$queryRaw<{
    domain: string; rows: bigint; oldest: Date | null; newest: Date | null; sweeps: Date | null
  }[]>`
    SELECT r.domain, COUNT(*)::bigint AS rows,
           MIN(rl.last_seen_at) AS oldest, MAX(rl.last_seen_at) AS newest,
           MIN(rl.last_seen_at) + interval '30 days' AS sweeps
    FROM retailer_listings rl JOIN retailers r ON r.id = rl.retailer_id
    WHERE rl.deleted_at IS NULL AND rl.price_amount > 0
    GROUP BY r.domain ORDER BY MIN(rl.last_seen_at)`
  for (const e of exp) {
    const days = e.sweeps ? (e.sweeps.getTime() - now) / 86_400_000 : null
    console.log(`  ${e.domain.padEnd(20)} ${String(Number(e.rows)).padStart(6)} priced rows · last seen ${iso(e.oldest)} .. ${iso(e.newest)} · first sweep ${iso(e.sweeps)}${days !== null ? ` (${days < 0 ? 'OVERDUE' : 'in ' + days.toFixed(1) + ' days'})` : ''}`)
  }

  await prisma.$disconnect()
}

main().catch(async e => { await prisma.$disconnect(); console.error(e); process.exit(1) })
