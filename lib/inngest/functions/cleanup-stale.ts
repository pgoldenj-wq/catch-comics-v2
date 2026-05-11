/**
 * cleanup.stale_listings — daily stale listing cleanup.
 *
 * Runs at 03:00 UTC daily. Two passes:
 *
 *   Pass 1 — OUT_OF_STOCK: mark listings as OUT_OF_STOCK if:
 *     - stock_status is IN_STOCK, LOW_STOCK, or PREORDER
 *     - last_seen_at is more than 7 days ago
 *     - not already soft-deleted
 *
 *   Pass 2 — Soft-delete: set deleted_at on listings where:
 *     - last_seen_at is more than 30 days ago
 *     - deleted_at is still null
 *
 * Soft-deletion preserves the row for price history integrity. The
 * product page and search queries filter WHERE deleted_at IS NULL.
 *
 * Results are logged to job_runs.
 */

import { inngest }  from '@/lib/inngest/client'
import { prisma }   from '@/lib/prisma'

const STALE_OOS_DAYS   = 7
const SOFT_DELETE_DAYS = 30

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000)
}

export const cleanupStale = inngest.createFunction(
  {
    id:       'cleanup-stale-listings',
    name:     'Cleanup Stale Listings',
    retries:  1,
    triggers: [{ cron: '0 3 * * *' }],   // 03:00 UTC daily
  },
  async ({ step }) => {
    // ── Step 1: create job run ───────────────────────────────────────────────
    const jobRun = await step.run('create-job-run', () =>
      prisma.jobRun.create({
        data: { jobName: 'cleanup.stale_listings', status: 'running' },
        select: { id: true },
      }),
    )

    // ── Step 2: mark stale listings OUT_OF_STOCK ─────────────────────────────
    const { count: markedOos } = await step.run('mark-out-of-stock', () =>
      prisma.retailerListing.updateMany({
        where: {
          deletedAt:   null,
          lastSeenAt:  { lt: daysAgo(STALE_OOS_DAYS) },
          stockStatus: { in: ['IN_STOCK', 'LOW_STOCK', 'PREORDER'] },
        },
        data: { stockStatus: 'OUT_OF_STOCK' },
      }),
    )

    console.log(`[cleanup-stale] marked ${markedOos} listings OUT_OF_STOCK (>7 days stale)`)

    // ── Step 3: soft-delete very old listings ────────────────────────────────
    const { count: softDeleted } = await step.run('soft-delete-old', () =>
      prisma.retailerListing.updateMany({
        where: {
          deletedAt:  null,
          lastSeenAt: { lt: daysAgo(SOFT_DELETE_DAYS) },
        },
        data: { deletedAt: new Date() },
      }),
    )

    console.log(`[cleanup-stale] soft-deleted ${softDeleted} listings (>30 days not seen)`)

    // ── Step 4: update job run ───────────────────────────────────────────────
    await step.run('update-job-run', () =>
      prisma.jobRun.update({
        where: { id: jobRun.id },
        data: {
          status:        'success',
          finishedAt:    new Date(),
          itemsProcessed: markedOos + softDeleted,
          metadata: {
            markedOutOfStock: markedOos,
            softDeleted,
          },
        },
      }),
    )

    return { markedOos, softDeleted }
  },
)
