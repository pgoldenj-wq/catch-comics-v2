/**
 * sync.retailer — background sync job for a single retailer.
 *
 * Triggered by:
 *   - sync.retailer.scheduled (hourly cron)
 *   - Admin "Queue sync" button (future)
 *
 * Steps:
 *   1. load-retailer         — verify the retailer exists and is active
 *   2. create-sync-log       — create a SyncLog row (status=running)
 *   3. run-adapter-sync      — call the correct adapter (ShopifyAdapter etc.)
 *   4. update-sync-log       — mark success/error, write summary
 *
 * Concurrency: max 5 runs in parallel globally (avoids hammering retailers).
 * Retries: 3 attempts with Inngest's default exponential backoff.
 */

import { inngest }      from '@/lib/inngest/client'
import { prisma }       from '@/lib/prisma'
import { dispatchSync } from '@/lib/sync/dispatch'

export const syncRetailer = inngest.createFunction(
  {
    id:          'sync-retailer',
    name:        'Sync Retailer',
    retries:     3,
    concurrency: { limit: 5 },
    triggers:    [{ event: 'sync/retailer' }],
  },
  async ({ event, step }) => {
    const { retailerId } = event.data as { retailerId: string }

    // ── Step 1: load retailer ────────────────────────────────────────────────
    const retailer = await step.run('load-retailer', async () => {
      const r = await prisma.retailer.findUnique({
        where:  { id: retailerId },
        select: { id: true, name: true, domain: true, isActive: true },
      })
      if (!r)          throw new Error(`Retailer ${retailerId} not found`)
      if (!r.isActive) throw new Error(`Retailer ${r.domain} is inactive — skipping sync`)
      return r
    })

    // ── Step 2: create sync log ──────────────────────────────────────────────
    const syncLog = await step.run('create-sync-log', () =>
      prisma.syncLog.create({
        data: { retailerId, status: 'running', startedAt: new Date() },
        select: { id: true },
      }),
    )

    // ── Step 3: run adapter ──────────────────────────────────────────────────
    // step.run re-throws on failure so Inngest can retry the whole function.
    const syncResult = await step.run('run-adapter-sync', () => dispatchSync(retailerId))

    // ── Step 4: update sync log ──────────────────────────────────────────────
    await step.run('update-sync-log', () =>
      prisma.syncLog.update({
        where: { id: syncLog.id },
        data: {
          status:          syncResult.errors.length > 0 ? 'error' : 'success',
          finishedAt:      new Date(),
          productsFetched: syncResult.productsFetched,
          listingsCreated: syncResult.listingsCreated,
          listingsUpdated: syncResult.listingsUpdated,
          priceChanges:    syncResult.priceChanges,
          errorCount:      syncResult.errors.length,
          errorSummary:    syncResult.errors.length > 0
            ? syncResult.errors.slice(0, 5).map(e => `[${e.type}] ${e.message}`).join('\n')
            : null,
        },
      }),
    )

    return {
      retailerId,
      domain:          retailer.domain,
      productsFetched: syncResult.productsFetched,
      listingsCreated: syncResult.listingsCreated,
      errors:          syncResult.errors.length,
      durationMs:      syncResult.durationMs,
    }
  },
)
