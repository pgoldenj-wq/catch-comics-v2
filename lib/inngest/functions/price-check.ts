/**
 * price_check.canonical_products — targeted re-sync of popular products.
 *
 * Runs every 4 hours. Finds the most-clicked canonical products in the
 * last 24 hours (via click_events → retailer_listings → retailers),
 * then enqueues sync/retailer events for the distinct retailers that stock them.
 *
 * This keeps pricing fresh on popular titles without re-syncing every retailer
 * on every run. A retailer with 3 popular products only gets one sync request.
 *
 * Conservative cap: up to 10 distinct retailers per run (concurrency handles
 * any overlap with the hourly scheduled sync).
 */

import { inngest }  from '@/lib/inngest/client'
import { prisma }   from '@/lib/prisma'

const LOOKBACK_HOURS = 24
const MAX_RETAILERS  = 10

export const priceCheck = inngest.createFunction(
  {
    id:       'price-check-canonical-products',
    name:     'Price Check Popular Products',
    retries:  1,
    triggers: [{ cron: '0 */4 * * *' }],   // every 4 hours
  },
  async ({ step }) => {
    // ── Step 1: create job run ───────────────────────────────────────────────
    const jobRun = await step.run('create-job-run', () =>
      prisma.jobRun.create({
        data: { jobName: 'price_check.canonical_products', status: 'running' },
        select: { id: true },
      }),
    )

    // ── Step 2: find most-clicked retailer IDs ───────────────────────────────
    const retailerIds = await step.run('find-top-clicked-retailers', async () => {
      const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000)

      const rows = await prisma.$queryRaw<Array<{ retailer_id: string; clicks: bigint }>>`
        SELECT
          rl.retailer_id,
          COUNT(ce.id) AS clicks
        FROM click_events ce
        JOIN retailer_listings rl ON rl.id = ce.listing_id
        JOIN retailers ret ON ret.id = rl.retailer_id
        WHERE
          ce.clicked_at >= ${since}
          AND ret.is_active = true
          AND rl.deleted_at IS NULL
        GROUP BY rl.retailer_id
        ORDER BY clicks DESC
        LIMIT ${MAX_RETAILERS}
      `

      return rows.map(r => r.retailer_id)
    })

    if (retailerIds.length === 0) {
      console.log('[price-check] no clicks in last 24h — nothing to re-sync')
      await step.run('update-job-run-empty', () =>
        prisma.jobRun.update({
          where: { id: jobRun.id },
          data:  { status: 'success', finishedAt: new Date(), itemsProcessed: 0 },
        }),
      )
      return { retailersEnqueued: 0 }
    }

    console.log(`[price-check] enqueuing re-sync for ${retailerIds.length} popular retailer(s)`)

    // ── Step 3: enqueue sync events ──────────────────────────────────────────
    await step.sendEvent(
      'enqueue-price-check-syncs',
      retailerIds.map((retailerId: string) => ({
        name: 'sync/retailer' as const,
        data: { retailerId },
      })),
    )

    // ── Step 4: update job run ───────────────────────────────────────────────
    await step.run('update-job-run', () =>
      prisma.jobRun.update({
        where: { id: jobRun.id },
        data: {
          status:        'success',
          finishedAt:    new Date(),
          itemsProcessed: retailerIds.length,
          metadata: { retailerIds },
        },
      }),
    )

    return { retailersEnqueued: retailerIds.length }
  },
)
