/**
 * bookshop/refresh — daily job to backfill and refresh Bookshop.org listings.
 *
 * Runs every day at 04:00 UTC.
 * Finds canonical products with isbn13 that either:
 *   - have no Bookshop.org listing at all, or
 *   - have a listing not seen in the last 7 days
 * and refreshes up to 100 per run (respects Bookshop.org API limits).
 *
 * The 7-day staleness threshold means every active product gets a Bookshop
 * price refresh approximately weekly — adequate for a price comparison site.
 */

import { inngest }                        from '@/lib/inngest/client'
import { prisma }                         from '@/lib/prisma'
import { refreshStaleBookshopListings }   from '@/lib/adapters/bookshop'
import { inngestCostGate }                from '@/lib/costguard/inngest'

export const bookshopRefresh = inngest.createFunction(
  {
    id      : 'bookshop-refresh',
    name    : 'Bookshop.org Daily Refresh',
    retries : 2,
    triggers: [{ cron: '0 4 * * *' }],
  },
  async ({ step }) => {
    // Cost Guard: bulk listing refresh — refuse cleanly when state blocks it.
    const costGate = await step.run('costguard-gate', () =>
      inngestCostGate({
        operation:    'inngest:bookshop-refresh',
        jobClass:     'nonessential',
        estRows:      5_000,
        estRequests:  1_000,
        maxRuntimeMs: 20 * 60_000,
        write:        true,
      }))
    if (!costGate.allowed) {
      console.warn(`[costguard] bookshop-refresh skipped: ${costGate.reason}`)
      return { skipped: 'costguard', reason: costGate.reason }
    }

    // ── Step 1: log job start ─────────────────────────────────────────────────
    const jobRun = await step.run('create-job-run', () =>
      prisma.jobRun.create({
        data  : { jobName: 'bookshop.refresh', status: 'running' },
        select: { id: true },
      }),
    )

    // ── Step 2: refresh stale listings ────────────────────────────────────────
    const stats = await step.run('refresh-listings', () =>
      refreshStaleBookshopListings(100, 7),
    )

    // ── Step 3: update job log ────────────────────────────────────────────────
    await step.run('update-job-run', () =>
      prisma.jobRun.update({
        where: { id: jobRun.id },
        data : {
          status        : 'success',
          finishedAt    : new Date(),
          itemsProcessed: stats.processed,
          metadata      : stats as unknown as object,
        },
      }),
    )

    return stats
  },
)
