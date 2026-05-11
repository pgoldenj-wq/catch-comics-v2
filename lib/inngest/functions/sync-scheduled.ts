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
 */

import { inngest }               from '@/lib/inngest/client'
import { prisma }                from '@/lib/prisma'
import { SKIP_PLATFORMS, refreshIntervalHours } from '@/lib/sync/dispatch'

export const syncScheduled = inngest.createFunction(
  {
    id:       'sync-retailer-scheduled',
    name:     'Scheduled Retailer Sync',
    triggers: [{ cron: '0 * * * *' }],   // every hour, on the hour
  },
  async ({ step }) => {
    // ── Step 1: find retailers due for sync ──────────────────────────────────
    const due = await step.run('find-due-retailers', async () => {
      const retailers = await prisma.retailer.findMany({
        where:  { isActive: true },
        select: {
          id:           true,
          domain:       true,
          platform:     true,
          lastSyncedAt: true,
          syncConfig:   true,
        },
      })

      const now = Date.now()

      return retailers
        .filter(r => {
          if (SKIP_PLATFORMS.has(r.platform)) return false
          const intervalMs = refreshIntervalHours(r.syncConfig, r.platform) * 60 * 60 * 1000
          const lastSynced = r.lastSyncedAt?.getTime() ?? 0
          return now - lastSynced >= intervalMs
        })
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
