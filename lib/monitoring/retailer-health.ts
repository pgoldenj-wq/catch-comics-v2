/**
 * retailer-health.ts — the single evaluation of "is each price source still
 * working", shared by the CLI report and the monitoring endpoint.
 *
 * Both callers MUST use this module. A monitor that computes health slightly
 * differently from the dashboard is worse than no monitor, because the two
 * disagree exactly when something is wrong.
 *
 * Nothing here writes. Callers decide what to do with the verdict.
 */

import { SKIP_PLATFORMS, DEFAULT_REFRESH_HOURS } from '@/lib/sync/dispatch'
import { SHOPIFY_VERIFY_DOMAINS } from '@/lib/inngest/functions/offer-refresh'

/** Days before cleanup-stale sweeps an unseen row. Mirrors cleanup-stale. */
export const SWEEP_DAYS = 30
/** A source with no fresh observation for this long is stale. */
export const STALE_HOURS = 48
/** Observed inside this window counts as freshly published. */
export const FRESH_HOURS = 12

/**
 * Grace on top of a retailer's own interval before "late" becomes "overdue".
 * GitHub throttles scheduled workflows hard — an "hourly" workflow in this repo
 * actually lands 2-4x a day — and Inngest ticks drift too. Without grace the
 * monitor would cry wolf on ordinary scheduling jitter, and an alarm that cries
 * wolf is the same as no alarm.
 */
export const OVERDUE_GRACE_HOURS = 6
/** Hourly dispatcher: this many consecutive missed ticks is an incident. */
export const SCHEDULER_MISSED_HOURS = 3
/** A drop larger than this against the last observation is an incident. */
export const COVERAGE_DROP_PCT = 20
/** job_runs.job_name written by the hourly dispatcher. */
export const SCHEDULER_JOB = 'sync_retailer.scheduled'
/** job_runs.job_name this monitor writes. */
export const MONITOR_JOB = 'monitor.retailer_health'

export type RetailerState =
  | 'FRESH' | 'CHECKED' | 'NOTHING_DUE' | 'VERIFIED_DAILY'
  | 'LIVE_LOOKUP' | 'BLOCKED' | 'STALE' | 'FAILED' | 'NO DATA'

export interface RetailerHealth {
  domain: string
  platform: string
  state: RetailerState
  priced: number
  lastCheck: Date | null
  lastObservation: Date | null
  nextDue: Date | null
  expiry: Date | null
  note: string
  /** True only for states that mean something is actually wrong. */
  fault: boolean
}

export interface Incident {
  /** Stable across runs, so "already open" can be told from "new". */
  key: string
  severity: 'critical' | 'warning'
  title: string
  details: string[]
  action: string
}

const hrs = (a: Date, b: Date) => (a.getTime() - b.getTime()) / 3_600_000
const num = (v: unknown) => Number(v ?? 0)
const iso = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'never'

/** Minimal shape so this works with the singleton and with a script's client. */
interface Queryable {
  $queryRaw<T = unknown>(q: TemplateStringsArray, ...v: unknown[]): Promise<T>
}

export const FAULT_STATES: RetailerState[] = ['STALE', 'FAILED', 'NO DATA']

export async function evaluateRetailerHealth(
  prisma: Queryable,
  now: Date = new Date(),
): Promise<RetailerHealth[]> {
  const next0200 = new Date(now)
  next0200.setUTCHours(2, 0, 0, 0)
  if (next0200 <= now) next0200.setUTCDate(next0200.getUTCDate() + 1)

  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT r.domain,
           r.platform::text AS platform,
           r.last_synced_at AS "lastSyncedAt",
           COALESCE((r.sync_config->'scheduled_sync_disabled') = 'true'::jsonb, false) AS disabled,
           CASE WHEN jsonb_typeof(r.sync_config->'refreshIntervalHours') = 'number'
                THEN (r.sync_config->>'refreshIntervalHours')::int END AS "intervalHours",
           COUNT(rl.id)::int    AS priced,
           MIN(rl.last_seen_at) AS "oldestSeen",
           MAX(rl.last_seen_at) AS "newestSeen",
           ph.newest_observation AS "newestObservation",
           la.status             AS "lastAttemptStatus"
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
      SELECT s.status FROM sync_logs s WHERE s.retailer_id = r.id
      ORDER BY s.started_at DESC LIMIT 1
    ) la ON true
    WHERE r.is_active = true
    GROUP BY r.id, r.domain, r.platform, r.last_synced_at, r.sync_config,
             ph.newest_observation, la.status
    ORDER BY COUNT(rl.id) DESC, r.domain
  `

  return rows.map(r => {
    const platform   = String(r.platform)
    const domain     = String(r.domain)
    const disabled   = r.disabled === true
    const skip       = SKIP_PLATFORMS.has(platform)
    const newestSeen = (r.newestSeen as Date | null) ?? null
    const oldestSeen = (r.oldestSeen as Date | null) ?? null
    const lastSynced = (r.lastSyncedAt as Date | null) ?? null
    const interval   = r.intervalHours === null || r.intervalHours === undefined
      ? (DEFAULT_REFRESH_HOURS[platform] ?? 24) : num(r.intervalHours)

    const verifiedDaily = SHOPIFY_VERIFY_DOMAINS.includes(domain)
    const isStale = !!newestSeen && hrs(now, newestSeen) > STALE_HOURS
    const isFresh = !!newestSeen && hrs(now, newestSeen) < FRESH_HOURS

    const nextDue = verifiedDaily ? next0200
      : lastSynced ? new Date(lastSynced.getTime() + interval * 3_600_000) : null
    const expiry  = oldestSeen ? new Date(oldestSeen.getTime() + SWEEP_DAYS * 864e5) : null

    let state: RetailerState
    if (platform === 'EBAY')                   state = 'LIVE_LOOKUP'
    else if (r.lastAttemptStatus === 'error')  state = 'FAILED'
    else if (verifiedDaily)                    state = isStale ? 'STALE' : isFresh ? 'FRESH' : 'VERIFIED_DAILY'
    else if (disabled || skip)                 state = 'BLOCKED'
    else if (!newestSeen)                      state = 'NO DATA'
    else if (isStale)                          state = 'STALE'
    else if (isFresh)                          state = 'FRESH'
    else if (nextDue && nextDue > now)         state = 'NOTHING_DUE'
    else                                       state = 'CHECKED'

    // A link-only retailer with no feed has nothing to go stale, so NO DATA
    // there is the designed state, not a fault.
    const fault = FAULT_STATES.includes(state) && !(state === 'NO DATA' && (skip || disabled))

    return {
      domain, platform, state, priced: num(r.priced),
      lastCheck: newestSeen,
      lastObservation: (r.newestObservation as Date | null) ?? null,
      nextDue, expiry,
      note: platform === 'EBAY'
          ? 'live Browse API lookup per shopper request — no stored rows by design'
          : verifiedDaily ? 'excluded from the hourly cron — covered by offer_refresh, daily 02:00 UTC'
          : disabled      ? 'scheduled_sync_disabled — NO automated cover'
          : skip          ? `${platform} in SKIP_PLATFORMS — affiliate link only, no price feed`
          : '',
      fault,
    }
  })
}

export interface IncidentContext {
  /** Most recent hourly-dispatcher tick, or null if it has never recorded one. */
  lastSchedulerTick: Date | null
  /** Total priced listings at the previous monitor run, if there was one. */
  previousPriced: number | null
}

/**
 * Turn health into incidents. Deliberately few, each one actionable: an alert
 * a reader cannot act on trains them to ignore the channel.
 */
export function detectIncidents(
  health: RetailerHealth[],
  ctx: IncidentContext,
  now: Date = new Date(),
): Incident[] {
  const out: Incident[] = []
  const totalPriced = health.reduce((s, h) => s + h.priced, 0)

  // 1. The dispatcher itself. Checked first: if it is dead, individual
  //    retailers will follow it down, and reporting five overdue retailers
  //    instead of one dead scheduler would bury the cause in the symptoms.
  const tickAge = ctx.lastSchedulerTick ? hrs(now, ctx.lastSchedulerTick) : null
  if (tickAge === null || tickAge > SCHEDULER_MISSED_HOURS) {
    out.push({
      key: 'scheduler-missed',
      severity: 'critical',
      title: 'The hourly price scheduler is not running',
      details: [
        ctx.lastSchedulerTick
          ? `last dispatcher tick ${iso(ctx.lastSchedulerTick)} (${tickAge!.toFixed(1)}h ago, allowed ${SCHEDULER_MISSED_HOURS}h)`
          : 'the dispatcher has never recorded a tick',
        'every feed-based retailer depends on it, so no Awin price can refresh',
        `${totalPriced} priced offers are affected as they come due`,
      ],
      action: 'Check sync-retailer-scheduled in Inngest (production → Functions): is it paused, or unregistered?',
    })
  }

  // 2. A single retailer late while the rest are fine — the case a
  //    site-wide smoke test cannot see.
  for (const h of health) {
    if (h.state === 'BLOCKED' || h.state === 'LIVE_LOOKUP') continue
    const lateBy = h.nextDue ? hrs(now, h.nextDue) : null
    const overdue = lateBy !== null && lateBy > OVERDUE_GRACE_HOURS
    if (!h.fault && !overdue) continue
    out.push({
      key: `retailer-overdue:${h.domain}`,
      severity: h.priced > 0 ? 'critical' : 'warning',
      title: `${h.domain} has stopped refreshing`,
      details: [
        `state ${h.state}${overdue ? ` · ${lateBy!.toFixed(1)}h past due (grace ${OVERDUE_GRACE_HOURS}h)` : ''}`,
        `last successful source check ${iso(h.lastCheck)}`,
        h.priced > 0
          ? `${h.priced} priced offers shoppers can see are going stale; they are swept from ${iso(h.expiry)}`
          : 'no priced offers from this retailer are visible to shoppers',
      ],
      action: h.note.includes('offer_refresh')
        ? 'Check offer-refresh-verified-offers in Inngest — this retailer is covered by the 02:00 job, not the hourly cron.'
        : `Run npm run awin:ingest -- ${h.domain} --write to restore prices now, then fix the schedule.`,
    })
  }

  // 3. Coverage falling without any single retailer looking broken — the
  //    shape of a silent partial failure.
  if (ctx.previousPriced !== null && ctx.previousPriced > 0) {
    const dropPct = ((ctx.previousPriced - totalPriced) / ctx.previousPriced) * 100
    if (dropPct > COVERAGE_DROP_PCT) {
      out.push({
        key: 'coverage-drop',
        severity: 'critical',
        title: 'Priced coverage fell sharply',
        details: [
          `priced offers ${ctx.previousPriced} → ${totalPriced} (down ${dropPct.toFixed(1)}%, threshold ${COVERAGE_DROP_PCT}%)`,
          'shoppers are seeing fewer prices than they were at the last check',
        ],
        action: 'Check whether cleanup-stale swept rows that should have been refreshed first.',
      })
    }
  }

  return out
}
