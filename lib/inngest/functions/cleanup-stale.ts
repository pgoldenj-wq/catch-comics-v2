/**
 * cleanup.stale_listings — daily stale listing cleanup.
 *
 * Runs at 03:00 UTC daily. Two passes:
 *
 *   Pass 1 — OUT_OF_STOCK: mark listings as OUT_OF_STOCK if:
 *     - stock_status is IN_STOCK, LOW_STOCK, or PREORDER
 *     - last_seen_at is more than 30 days ago  (raised from 7 — AWIN/direct feeds
 *       are synced manually and were being wiped too aggressively)
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
import { inngestCostGate } from '@/lib/costguard/inngest'

const STALE_OOS_DAYS   = 30
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
    // Cost Guard: soft-delete sweep — deferrable (data hygiene), blocked only
    // in LOCKDOWN.
    const costGate = await step.run('costguard-gate', () =>
      inngestCostGate({
        operation:    'inngest:cleanup-stale',
        jobClass:     'deferrable',
        estRows:      50_000,
        estRequests:  10,
        maxRuntimeMs: 10 * 60_000,
        write:        true,
      }))
    if (!costGate.allowed) {
      console.warn(`[costguard] cleanup-stale skipped: ${costGate.reason}`)
      return { skipped: 'costguard', reason: costGate.reason }
    }

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

    console.log(`[cleanup-stale] marked ${markedOos} listings OUT_OF_STOCK (>${STALE_OOS_DAYS} days stale)`)

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
