/**
 * sync.retailer.scheduled — hourly cron that enqueues sync jobs.
 *
 * Runs every hour. For each active retailer:
 *   1. Compute its refresh interval (syncConfig.refreshIntervalHours or platform default)
 *   2. Skip if last_synced_at is recent enough
 *   3. Enqueue sync/retailer event for those that are due
 *
 * Concurrency is enforced by the sync.retailer function (limit: 5).
 * This cron can safely enqueue as many as needed.
 *
 * Platforms skipped: EBAY (live search API), MANUAL (human entry only).
 * Retailers with syncConfig.scheduled_sync_disabled are never enqueued —
 * they are refreshed only via the gated CLI sync (see lib/sync/dispatch.ts).
 */

import { inngest }               from '@/lib/inngest/client'
import { prisma }                from '@/lib/prisma'
import { isDueForScheduledSync } from '@/lib/sync/dispatch'
import { inngestCostGate }       from '@/lib/costguard/inngest'

export const syncScheduled = inngest.createFunction(
  {
    id:       'sync-retailer-scheduled',
    name:     'Scheduled Retailer Sync',
    triggers: [{ cron: '0 * * * *' }],   // every hour, on the hour
  },
  async ({ step }) => {
    // Cost Guard: skip cleanly (no retries) when the spend state blocks
    // nonessential work. Blocking THIS cron stops the whole hourly pipeline.
    const costGate = await step.run('costguard-gate', () =>
      inngestCostGate({
        operation:    'inngest:sync-retailer-scheduled',
        jobClass:     'nonessential',
        estRows:      500,
        estRequests:  50,
        maxRuntimeMs: 5 * 60_000,
        write:        false,
      }))
    if (!costGate.allowed) {
      console.warn(`[costguard] sync-scheduled skipped: ${costGate.reason}`)
      return { enqueued: 0, skipped: 'costguard', reason: costGate.reason }
    }

    // ── Step 1: find retailers due for sync ──────────────────────────────────
    const due = await step.run('find-due-retailers', async () => {
      // Raw SQL, not findMany({ select: { syncConfig: true } }): selecting the
      // whole `sync_config` column pulled 6 MB from worldofbooks.com alone on
      // every hourly tick (~156 MB/day of Neon egress). Only two keys out of it
      // are needed to decide "is this retailer due", so Postgres extracts them
      // server-side. The lateral joins read the attempt history from sync_logs,
      // which is what makes the failure backoff possible without a migration.
      const rows = await prisma.$queryRaw<Array<{
        id: string
        domain: string
        platform: string
        lastSyncedAt: Date | null
        scheduledSyncDisabled: boolean
        refreshIntervalHours: number | null
        lastAttemptAt: Date | null
        lastAttemptStatus: string | null
        consecutiveFailures: number
      }>>`
        SELECT r.id,
               r.domain,
               r.platform,
               r.last_synced_at AS "lastSyncedAt",
               -- Strict JSON-boolean match, mirroring isScheduledSyncDisabled:
               -- the string "true" is not the flag, and no value can raise a
               -- cast error that would take the whole scheduler down.
               COALESCE((r.sync_config->'scheduled_sync_disabled') = 'true'::jsonb, false) AS "scheduledSyncDisabled",
               CASE WHEN jsonb_typeof(r.sync_config->'refreshIntervalHours') = 'number'
                    THEN (r.sync_config->>'refreshIntervalHours')::int END AS "refreshIntervalHours",
               la.started_at    AS "lastAttemptAt",
               la.status        AS "lastAttemptStatus",
               COALESCE(cf.n, 0)::int AS "consecutiveFailures"
        FROM retailers r
        LEFT JOIN LATERAL (
          SELECT s.started_at, s.status
          FROM sync_logs s
          WHERE s.retailer_id = r.id
          ORDER BY s.started_at DESC
          LIMIT 1
        ) la ON true
        -- Attempts since the last genuinely successful sync. Keyed off
        -- last_synced_at (which the adapter advances on real completion), NOT
        -- off sync_logs.status: the log row only reaches 'success' if the
        -- Inngest run also survives its final step, which these feeds rarely do
        -- (travellingman.com has 0 success rows despite completing on Aug 1).
        LEFT JOIN LATERAL (
          SELECT count(*) AS n
          FROM sync_logs s
          WHERE s.retailer_id = r.id
            AND s.started_at > COALESCE(r.last_synced_at, '-infinity'::timestamptz)
        ) cf ON true
        WHERE r.is_active = true
      `

      const now = Date.now()

      return rows
        .filter(r => isDueForScheduledSync({
          platform:            r.platform,
          lastSyncedAt:        r.lastSyncedAt,
          // Rebuild the minimal shape the pure predicate expects, without ever
          // having transferred the rest of the blob.
          syncConfig: {
            ...(r.scheduledSyncDisabled === true ? { scheduled_sync_disabled: true } : {}),
            ...(r.refreshIntervalHours !== null ? { refreshIntervalHours: r.refreshIntervalHours } : {}),
          },
          lastAttemptAt:       r.lastAttemptAt,
          lastAttemptStatus:   r.lastAttemptStatus,
          consecutiveFailures: r.consecutiveFailures,
        }, now))
        .map(r => ({ id: r.id, domain: r.domain }))
    })

    if (due.length === 0) {
      console.log('[sync-scheduled] no retailers due — nothing to enqueue')
      return { enqueued: 0 }
    }

    console.log(`[sync-scheduled] enqueuing ${due.length} retailer sync(s): ${due.map((r: { id: string; domain: string }) => r.domain).join(', ')}`)

    // ── Step 2: enqueue sync events ──────────────────────────────────────────
    await step.sendEvent(
      'enqueue-retailer-syncs',
      due.map((r: { id: string; domain: string }) => ({
        name: 'sync/retailer' as const,
        data: { retailerId: r.id },
      })),
    )

    return { enqueued: due.length, retailers: due.map((r: { id: string; domain: string }) => r.domain) }
  },
)
