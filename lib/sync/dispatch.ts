/**
 * Sync dispatcher — routes a sync job to the correct platform adapter.
 *
 * Called by:
 *   - lib/inngest/functions/sync-retailer.ts  (background job)
 *   - app/api/admin/retailers/[id]/sync/route.ts  (manual "Sync now")
 *
 * Both paths create/update a SyncLog row before/after calling here.
 * This function only calls the adapter — it does not touch SyncLog directly.
 */

import { prisma }              from '@/lib/prisma'
import { ShopifyAdapter }      from '@/lib/adapters/shopify'
import { BigCommerceAdapter }  from '@/lib/adapters/bigcommerce'
import { WooCommerceAdapter }  from '@/lib/adapters/woocommerce'
import { AwinFeedAdapter }     from '@/lib/adapters/awin-feed'
import type { SyncResult }     from '@/lib/adapters/shared/matching'
import { withFanoutBudget, fanoutSuppressionNotice } from '@/lib/adapters/shared/fanout'

// Platforms we skip in the scheduled cron.
// EBAY: queried live at request time, no batch sync needed.
// MANUAL: hand-entry only.
// DIRECT_AFFILIATE / CJ_FEED: no feed adapter implemented — sync throws, creating
// stuck "running" SyncLog rows. These are synced via dedicated CLI scripts instead.
// DYNAMIC_LINK: listings are generated from ISBN URL templates at DB seed time — no feed to sync.
export const SKIP_PLATFORMS = new Set(['EBAY', 'MANUAL', 'DIRECT_AFFILIATE', 'CJ_FEED', 'DYNAMIC_LINK'])

// Default refresh interval in hours, by platform.
export const DEFAULT_REFRESH_HOURS: Record<string, number> = {
  SHOPIFY:          6,
  BIGCOMMERCE:      6,
  WOOCOMMERCE:      6,
  AWIN_FEED:       24,
  CJ_FEED:         24,
  DIRECT_AFFILIATE:24,
}

/**
 * Per-retailer opt-out from the scheduled/adapter sync path.
 *
 * Set `syncConfig.scheduled_sync_disabled: true` on a retailer whose feed must
 * only be refreshed through a gated CLI sync. The adapter path has no
 * comics-only gate: it refreshes (and revives, via `deletedAt: null`) every
 * feed row and creates stub canonicals for unknown ISBNs — for a general
 * bookstore feed like Lets Buy Books that means re-importing non-comic
 * catalogue pollution every run. The gated path is:
 *   npm run sync:awin -- --merchant <name> --no-create --comics-only --write
 */
export function isScheduledSyncDisabled(syncConfig: unknown): boolean {
  return (
    typeof syncConfig === 'object' &&
    syncConfig !== null &&
    (syncConfig as Record<string, unknown>).scheduled_sync_disabled === true
  )
}

// ── Failed-sync backoff (2026-08-09 Inngest quota incident) ──────────────────
//
// `lastSyncedAt` advances ONLY on a successful completed sync. That is correct
// and must stay that way — it is the "when was this retailer's data last known
// good" field, and product/ops surfaces read it as such.
//
// The bug it caused: a retailer whose sync always times out never advances
// `lastSyncedAt`, so `now - lastSyncedAt >= interval` was true on every single
// hourly tick, forever. worldofbooks.com (529,927 listings, always times out)
// burned 24 runs/day for two months; amazon.co.uk, whose `lastSyncedAt` is
// still null (→ epoch), did the same having never once synced.
//
// The fix reads the attempt history that `sync_logs` already records, so there
// is no schema migration and no new state to keep in step:
//   - an attempt that is still `running` holds a lease — no overlapping run;
//   - an attempt that did not succeed imposes a cooldown that doubles per
//     consecutive failure, capped, so a permanently broken retailer settles at
//     one attempt per day instead of twenty-four.
// A success clears both, because the failure streak resets to 0.

/** A `running` sync_log older than this is treated as dead, not in-flight. */
export const RUN_LEASE_MS = 30 * 60 * 1000

/** First cooldown after a failed/incomplete attempt; doubles per consecutive failure. */
export const FAILURE_COOLDOWN_BASE_MS = 60 * 60 * 1000

/** Ceiling on the doubling — a hopeless retailer retries once a day, not hourly. */
export const FAILURE_COOLDOWN_MAX_MS = 24 * 60 * 60 * 1000

/**
 * How long a retailer must wait after `consecutiveFailures` unsuccessful
 * attempts: 1h, 2h, 4h, 8h, 16h, then capped at 24h.
 */
export function failureCooldownMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return 0
  const doubled = FAILURE_COOLDOWN_BASE_MS * 2 ** (consecutiveFailures - 1)
  return Math.min(doubled, FAILURE_COOLDOWN_MAX_MS)
}

/**
 * Attempt history for one retailer, derived from `sync_logs` by the scheduler.
 * All fields optional so callers that only care about the interval rule (and
 * the existing containment tests) keep working unchanged.
 */
export interface SyncAttemptState {
  /** started_at of the most recent sync_log, or null if never attempted. */
  lastAttemptAt?: Date | null
  /** status of that most recent sync_log: 'running' | 'success' | 'error'. */
  lastAttemptStatus?: string | null
  /**
   * Attempts started since the last SUCCESSFUL sync — i.e. since `lastSyncedAt`.
   *
   * Deliberately derived from `lastSyncedAt` and not from `sync_logs.status`:
   * the adapter advances `lastSyncedAt` itself when it genuinely finishes,
   * whereas the log row only reaches 'success' if the Inngest function also
   * survives long enough to run its final step — which, on these feeds, it
   * usually does not. In production travellingman.com has 0 rows at
   * status='success' despite having really completed a sync on 2026-08-01, so
   * trusting the log status would pin a healthy retailer at the 24 h cap
   * forever.
   */
  consecutiveFailures?: number
}

/**
 * Is this retailer currently protected from being dispatched by a recent
 * attempt — either because a run holds the in-flight lease, or because the
 * failure cooldown has not elapsed?
 *
 * Shared by EVERY automatic dispatcher. price-check originally had its own
 * (weaker) rules and re-enqueued retailers the scheduler had already excluded,
 * so the protections had to be duplicated to be bypassed. One predicate now.
 */
export function isBlockedByRecentAttempt(r: SyncAttemptState, now: number): boolean {
  const lastAttempt = r.lastAttemptAt?.getTime() ?? null
  if (lastAttempt === null) return false

  // In-flight lease: never run two syncs for the same retailer at once.
  if (r.lastAttemptStatus === 'running' && now - lastAttempt < RUN_LEASE_MS) return true

  // Failure backoff. 0 failures means the last attempt produced the current
  // lastSyncedAt — a real success — so nothing is owed.
  const fails = r.consecutiveFailures ?? 0
  return fails > 0 && now - lastAttempt < failureCooldownMs(fails)
}

/**
 * Should the scheduled cron enqueue a sync for this retailer right now?
 * Pure — the cron passes each active retailer plus the current time.
 */
export function isDueForScheduledSync(
  r: {
    platform: string
    lastSyncedAt: Date | null
    syncConfig: unknown
  } & SyncAttemptState,
  now: number,
): boolean {
  if (SKIP_PLATFORMS.has(r.platform)) return false
  if (isScheduledSyncDisabled(r.syncConfig)) return false

  if (isBlockedByRecentAttempt(r, now)) return false

  const intervalMs = refreshIntervalHours(r.syncConfig, r.platform) * 60 * 60 * 1000
  const lastSynced = r.lastSyncedAt?.getTime() ?? 0
  return now - lastSynced >= intervalMs
}

/**
 * Run a full sync for a retailer and return the result.
 * Throws on unrecognised platform — let the caller handle it.
 */
export async function dispatchSync(retailerId: string): Promise<SyncResult> {
  // Deliberately NOT `findUniqueOrThrow({ where: { id } })`: that selects every
  // column, including `sync_config`, which is 6 MB on worldofbooks.com
  // (`prev_missing_skus` grows unboundedly). This function only needs the
  // domain, the platform, and one boolean out of that blob — so Postgres
  // extracts the key server-side and ships ~100 bytes instead of 6 MB. The
  // adapter re-reads the full row itself when it genuinely needs the config.
  // `-> ... = 'true'::jsonb` (not `->>...::boolean`) so this matches
  // isScheduledSyncDisabled exactly: only a real JSON boolean true counts, the
  // string "true" does not, and a malformed value can never raise a cast error
  // and take the whole sync down.
  const [retailer] = await prisma.$queryRaw<Array<{
    domain: string
    platform: string
    scheduledSyncDisabled: boolean
  }>>`
    SELECT domain,
           platform,
           COALESCE((sync_config->'scheduled_sync_disabled') = 'true'::jsonb, false) AS "scheduledSyncDisabled"
    FROM retailers
    WHERE id = ${retailerId}::uuid
  `
  if (!retailer) throw new Error(`Retailer ${retailerId} not found`)

  // Defence in depth: events already queued (or retried) before the scheduler
  // filter excluded this retailer must not reach the ungated adapter either.
  if (retailer.scheduledSyncDisabled === true) {
    throw new Error(
      `Adapter sync is disabled for ${retailer.domain} (syncConfig.scheduled_sync_disabled). ` +
      `Refresh it with the gated CLI sync instead: ` +
      `npm run sync:awin -- --merchant <name> --no-create --comics-only --write`,
    )
  }

  // Every adapter path below runs inside one child-event budget, so a single
  // runaway ingest cannot emit tens of thousands of bookshop/lookup events.
  const runAdapter = async (): Promise<SyncResult> => {
    const { result, budget } = await withFanoutBudget(async () => {
      switch (retailer.platform) {
        case 'SHOPIFY':     return new ShopifyAdapter().syncRetailer(retailerId)
        case 'BIGCOMMERCE': return new BigCommerceAdapter().syncRetailer(retailerId)
        case 'WOOCOMMERCE': return new WooCommerceAdapter().syncRetailer(retailerId)
        case 'AWIN_FEED':   return new AwinFeedAdapter().syncFeed(retailerId)
        default:            throw new Error(`unreachable platform ${retailer.platform}`)
      }
    })

    // Truthful reporting: a capped run is not a clean run.
    const notice = fanoutSuppressionNotice(budget)
    if (notice) result.errors.push({ type: 'upsert', message: notice, context: retailer.domain })
    return result
  }

  switch (retailer.platform) {
    case 'SHOPIFY':
    case 'BIGCOMMERCE':
    case 'WOOCOMMERCE':
    case 'AWIN_FEED':
      return runAdapter()

    case 'CJ_FEED':
    case 'DIRECT_AFFILIATE':
      throw new Error(
        `Feed adapter for ${retailer.platform} not yet implemented for ${retailer.domain}.`,
      )

    case 'EBAY':
    case 'MANUAL':
      throw new Error(
        `Platform ${retailer.platform} does not support scheduled sync — ` +
        `filter these out in the scheduler before calling dispatchSync.`,
      )

    default:
      throw new Error(`Unknown platform "${retailer.platform}" for retailer ${retailer.domain}`)
  }
}

/**
 * How many hours between syncs for this retailer.
 * Uses syncConfig.refreshIntervalHours if set, otherwise platform default.
 */
export function refreshIntervalHours(syncConfig: unknown, platform: string): number {
  if (
    syncConfig &&
    typeof syncConfig === 'object' &&
    'refreshIntervalHours' in syncConfig &&
    typeof (syncConfig as Record<string, unknown>).refreshIntervalHours === 'number'
  ) {
    return (syncConfig as { refreshIntervalHours: number }).refreshIntervalHours
  }
  return DEFAULT_REFRESH_HOURS[platform] ?? 24
}
