/**
 * offer_health.check — daily watchdog over priced offer coverage.
 *
 * Separate from offer_refresh on purpose. If the refresh never runs, a check
 * living inside it never runs either — which is precisely how B4 stayed
 * invisible for a month. This job's only dependency is Inngest's own cron.
 *
 * Runs at 04:00 UTC: after the 02:00 refresh and after cleanup-stale's 03:00
 * sweep, so it reports the real state of the day rather than a mid-flight one.
 *
 * It decides nothing itself — lib/alerts/offer-health.ts is a pure function of
 * the snapshot, so the alarms are testable without waiting for a cron.
 *
 * Reads and alerts only. The sole write is its own job_runs row, which is also
 * where the previous coverage reading is kept so "falling" can be detected
 * without a schema change.
 */

import { inngest }         from '@/lib/inngest/client'
import { prisma }          from '@/lib/prisma'
import { Prisma }          from '@prisma/client'
import { inngestCostGate } from '@/lib/costguard/inngest'
import { raiseAlert }      from '@/lib/alerts/notify'
import { evaluateOfferHealth } from '@/lib/alerts/offer-health'

const REFRESH_JOB = 'offer_refresh.verified_offers'
const HEALTH_JOB  = 'offer_health.check'

export const offerHealthCheck = inngest.createFunction(
  {
    id:       'offer-health-check',
    name:     'Offer Coverage Health Check',
    retries:  1,
    triggers: [{ cron: '0 4 * * *' }],   // 04:00 UTC — after refresh and sweep
  },
  async ({ step }) => {
    // Tiny and read-only, but still gated so LOCKDOWN means lockdown.
    const costGate = await step.run('costguard-gate', () =>
      inngestCostGate({
        operation:    'inngest:offer-health-check',
        jobClass:     'deferrable',
        estRows:      10,
        estRequests:  0,
        maxRuntimeMs: 30_000,
        write:        false,
      }))
    if (!costGate.allowed) {
      console.warn(`[costguard] offer-health-check skipped: ${costGate.reason}`)
      return { skipped: 'costguard', reason: costGate.reason }
    }

    const snapshot = await step.run('gather-snapshot', async () => {
      const [priced] = await prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*)::bigint AS c FROM retailer_listings
        WHERE deleted_at IS NULL AND price_amount > 0`
      const [products] = await prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(DISTINCT canonical_product_id)::bigint AS c FROM retailer_listings
        WHERE deleted_at IS NULL AND price_amount > 0 AND canonical_product_id IS NOT NULL`
      const [two] = await prisma.$queryRaw<{ c: bigint }[]>`
        SELECT COUNT(*)::bigint AS c FROM (
          SELECT canonical_product_id FROM retailer_listings
          WHERE deleted_at IS NULL AND price_amount > 0 AND canonical_product_id IS NOT NULL
          GROUP BY canonical_product_id HAVING COUNT(DISTINCT retailer_id) >= 2) t`
      const [oldest] = await prisma.$queryRaw<{ ts: Date | null }[]>`
        SELECT MIN(last_seen_at) AS ts FROM retailer_listings
        WHERE deleted_at IS NULL AND price_amount > 0`

      const lastRefresh = await prisma.jobRun.findFirst({
        where:   { jobName: REFRESH_JOB, status: 'success' },
        orderBy: { finishedAt: 'desc' },
        select:  { finishedAt: true },
      })

      // Previous coverage reading comes from this job's own last run.
      const lastHealth = await prisma.jobRun.findFirst({
        where:   { jobName: HEALTH_JOB, status: 'success' },
        orderBy: { finishedAt: 'desc' },
        select:  { metadata: true },
      })
      const prev = (lastHealth?.metadata as { pricedListings?: number } | null)?.pricedListings

      return {
        pricedListings:          Number(priced.c),
        pricedProducts:          Number(products.c),
        productsAtTwoRetailers:  Number(two.c),
        previousPricedListings:  typeof prev === 'number' ? prev : null,
        lastSuccessfulRefreshAt: lastRefresh?.finishedAt?.toISOString() ?? null,
        oldestActiveLastSeenAt:  oldest.ts ? new Date(oldest.ts).toISOString() : null,
      }
    })

    const verdict = evaluateOfferHealth({
      now: new Date(),
      pricedListings:         snapshot.pricedListings,
      pricedProducts:         snapshot.pricedProducts,
      productsAtTwoRetailers: snapshot.productsAtTwoRetailers,
      previousPricedListings: snapshot.previousPricedListings,
      lastSuccessfulRefreshAt: snapshot.lastSuccessfulRefreshAt ? new Date(snapshot.lastSuccessfulRefreshAt) : null,
      oldestActiveLastSeenAt:  snapshot.oldestActiveLastSeenAt ? new Date(snapshot.oldestActiveLastSeenAt) : null,
    })

    for (const alert of verdict.alerts) {
      await step.run(`alert-${alert.key}`, () => raiseAlert(alert))
    }

    await step.run('record-job-run', () =>
      prisma.jobRun.create({
        data: {
          jobName:        HEALTH_JOB,
          status:         'success',
          finishedAt:     new Date(),
          itemsProcessed: verdict.alerts.length,
          metadata: {
            ...snapshot,
            daysToExpiry:      verdict.daysToExpiry,
            hoursSinceRefresh: verdict.hoursSinceRefresh,
            alertKeys:         verdict.alerts.map(a => a.key),
          } as unknown as Prisma.InputJsonValue,
        },
      }))

    console.log(`[offer-health] priced ${snapshot.pricedListings} · 2+ retailers ${snapshot.productsAtTwoRetailers} · days to expiry ${verdict.daysToExpiry?.toFixed(1) ?? 'n/a'} · alerts ${verdict.alerts.length}`)
    return { ...snapshot, alerts: verdict.alerts.map(a => a.key), daysToExpiry: verdict.daysToExpiry }
  },
)
