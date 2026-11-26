/**
 * offer_refresh.verified_offers — daily targeted refresh of the verified offer
 * set, hosted on Vercel and triggered by Inngest cron.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Blocker B4 was not a code bug. Travelling Man and World of Books carry
 * `scheduled_sync_disabled`, so the hourly sync and the 4-hourly price-check
 * both skip them by design. Their freshness depended on someone running a CLI
 * script by hand. On 2026-09-26 that manual run was the last one, and thirty
 * days later cleanup-stale soft-deleted all 2,246 remaining rows — correctly,
 * by its own rules. The site went to zero prices and nothing noticed.
 *
 * This job removes the human from that loop. It is deliberately NOT the
 * existing retailer sync: it re-verifies a small, already-established set of
 * offers rather than re-ingesting a catalogue, so it stays cheap enough to run
 * every day.
 *
 * SCHEDULE
 * ────────
 * 02:00 UTC daily — ONE HOUR BEFORE cleanup-stale's 03:00 sweep. Ordering is
 * the point: freshness is renewed before the sweep evaluates it, so an offer
 * can never reach 30 days unseen while this job is running. A 30-day policy
 * refreshed daily leaves 29 days of margin.
 *
 * It runs on Inngest's hosted schedule against the deployed Vercel app, so it
 * does not depend on anyone's laptop being open.
 *
 * TWO PASSES
 * ──────────
 * Normal pass — ACTIVE listings only, scoped `deletedAt: null`. That is the
 * existing guard from scripts/price-verify-dryrun.ts and it is NOT relaxed
 * here: routine operation must never resurrect dead stock.
 *
 * Recovery pass — runs ONLY when a target retailer has zero active priced
 * rows, which is exactly the state B4 described and the state a normal
 * active-only refresh cannot escape. It may then revive up to RECOVERY_MAX
 * rows from the single 27 October sweep cohort, and only rows that verify
 * live AND available in the same run. Sold-out editions are never revived.
 *
 * BOUNDS
 * ──────
 * Requests, rows, retries and runtime are all capped, and the Cost Guard gates
 * the whole job. Worst case is MAX_ROWS + RECOVERY_MAX product requests at
 * ~1/s against one public Shopify endpoint, well inside the serverless limit.
 */

import { inngest }           from '@/lib/inngest/client'
import { prisma }            from '@/lib/prisma'
import { Prisma }            from '@prisma/client'
import { inngestCostGate }   from '@/lib/costguard/inngest'
import { raiseAlert }        from '@/lib/alerts/notify'
import {
  verifyRow, isImplausiblePrice, resetCost, cost,
  PURCHASABLE_KLASSES, VERIFIED_KLASSES,
} from '@/lib/retailers/shopify-verify'

/**
 * Domains the shared Shopify verifier can prove identity against: the stored
 * retailer_url must contain a /products/<handle> path on a Shopify store.
 * Adding a domain here requires that to be true of its rows.
 */
const SHOPIFY_VERIFY_DOMAINS = ['travellingman.com', 'worldofbooks.com']

/**
 * The one soft-delete cohort the recovery pass may reverse: the 27 October 2026
 * retention sweep. Pinned so that manually suppressed rows and every other
 * sweep are unreachable by construction.
 */
const RECOVERABLE_SWEEP_AT = new Date('2026-10-27T03:00:46.263Z')
const RECOVERY_DOMAIN      = 'travellingman.com'

// ── Hard ceilings ───────────────────────────────────────────────────────────
const MAX_ROWS      = 50   // active rows refreshed per run
const RECOVERY_MAX  = 10   // rows revived per run, only from zero-coverage
const BETWEEN_MS    = 700  // sequential, no concurrency
const MAX_RUNTIME_MS = 120_000

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

interface Tally {
  checked: number
  refreshed: number
  revived: number
  soldOut: number
  priceChanges: number
  historyRows: number
  failures: number
  skippedImplausible: number
}

export const offerRefresh = inngest.createFunction(
  {
    id:       'offer-refresh-verified-offers',
    name:     'Refresh Verified Retailer Offers',
    retries:  1,
    triggers: [{ cron: '0 2 * * *' }],   // 02:00 UTC — before the 03:00 sweep
  },
  async ({ step }) => {
    // Cost Guard: price freshness matters to shoppers, and this job is the only
    // thing standing between the catalogue and another silent expiry — so it is
    // deferrable (keeps running in RED, stops only in LOCKDOWN).
    const costGate = await step.run('costguard-gate', () =>
      inngestCostGate({
        operation:    'inngest:offer-refresh',
        jobClass:     'deferrable',
        estRows:      MAX_ROWS + RECOVERY_MAX,
        estRequests:  MAX_ROWS + RECOVERY_MAX,
        maxRuntimeMs: MAX_RUNTIME_MS,
        write:        true,
      }))
    if (!costGate.allowed) {
      console.warn(`[costguard] offer-refresh skipped: ${costGate.reason}`)
      return { skipped: 'costguard', reason: costGate.reason }
    }

    const jobRun = await step.run('create-job-run', () =>
      prisma.jobRun.create({
        data: { jobName: 'offer_refresh.verified_offers', status: 'running' },
        select: { id: true },
      }))

    const result = await step.run('verify-and-write', async () => {
      const t0 = Date.now()
      resetCost()
      const tally: Tally = {
        checked: 0, refreshed: 0, revived: 0, soldOut: 0,
        priceChanges: 0, historyRows: 0, failures: 0, skippedImplausible: 0,
      }
      const failureDetail: { endpoint: string; klass: string; effect: string }[] = []

      const retailers = await prisma.retailer.findMany({
        where:  { domain: { in: SHOPIFY_VERIFY_DOMAINS } },
        select: { id: true, name: true, domain: true },
      })

      // ── Normal pass: ACTIVE rows only ─────────────────────────────────────
      for (const r of retailers) {
        const rows = await prisma.retailerListing.findMany({
          where: {
            retailerId: r.id,
            deletedAt:  null,          // the existing guard, unchanged
            priceAmount: { gt: 0 },
          },
          orderBy: { lastSeenAt: 'asc' },   // the closest to expiry go first
          take: MAX_ROWS,
          select: { id: true, retailerSku: true, retailerUrl: true, priceAmount: true },
        })

        for (const row of rows) {
          if (Date.now() - t0 > MAX_RUNTIME_MS) break
          tally.checked++
          const v = await verifyRow(r.domain, row)

          if (!VERIFIED_KLASSES.includes(v.klass)) {
            tally.failures++
            if (failureDetail.length < 10) {
              failureDetail.push({
                endpoint: `https://${r.domain}/products/<handle>.js`,
                klass:    v.klass,
                effect:   'row left exactly as it was — a failed request is never treated as fresh or as out-of-stock',
              })
            }
            await sleep(BETWEEN_MS)
            continue
          }

          const stored = Number(row.priceAmount)
          const live   = Number(v.live)
          if (isImplausiblePrice(stored, live)) {
            tally.skippedImplausible++
            await sleep(BETWEEN_MS)
            continue
          }

          const soldOut = v.klass === 'unavailable'
          const priceChanged = live !== stored
          const now = new Date()

          // Still scoped deletedAt: null — a soft-deleted row is unreachable.
          const upd = await prisma.retailerListing.updateMany({
            where: { id: row.id, deletedAt: null },
            data: {
              priceAmount: new Prisma.Decimal(v.live!),
              stockStatus: soldOut ? 'OUT_OF_STOCK' : 'IN_STOCK',
              lastSeenAt:  now,
              ...(priceChanged ? { lastPriceChangeAt: now } : {}),
            },
          })
          if (upd.count !== 1) { await sleep(BETWEEN_MS); continue }

          tally.refreshed++
          if (soldOut) tally.soldOut++
          if (priceChanged) {
            tally.priceChanges++
            await prisma.priceHistory.create({
              data: {
                retailerListingId: row.id,
                priceAmount:       new Prisma.Decimal(v.live!),
                priceCurrency:     'GBP',
                stockStatus:       soldOut ? 'OUT_OF_STOCK' : 'IN_STOCK',
                recordedAt:        now,
              },
            })
            tally.historyRows++
          }
          await sleep(BETWEEN_MS)
        }
      }

      // ── Recovery pass: ONLY from zero active priced coverage ──────────────
      // This is the escape hatch an active-only refresh cannot provide. Without
      // it, one retention sweep permanently ends pricing on the site.
      const recovery = retailers.find(r => r.domain === RECOVERY_DOMAIN)
      let recoveryTriggered = false
      if (recovery) {
        const activePriced = await prisma.retailerListing.count({
          where: { retailerId: recovery.id, deletedAt: null, priceAmount: { gt: 0 } },
        })
        if (activePriced === 0) {
          recoveryTriggered = true
          const dead = await prisma.$queryRaw<{
            id: string; retailer_sku: string; retailer_url: string; price_amount: Prisma.Decimal
          }[]>`
            SELECT rl.id, rl.retailer_sku, rl.retailer_url, rl.price_amount
            FROM retailer_listings rl
            WHERE rl.retailer_id = ${recovery.id}::uuid
              AND rl.deleted_at = ${RECOVERABLE_SWEEP_AT}
              AND rl.price_amount > 0
              AND rl.canonical_product_id IS NOT NULL
            ORDER BY rl.price_amount DESC
            LIMIT ${RECOVERY_MAX * 3}`

          for (const row of dead) {
            if (tally.revived >= RECOVERY_MAX) break
            if (Date.now() - t0 > MAX_RUNTIME_MS) break
            tally.checked++
            const v = await verifyRow(recovery.domain, {
              id: row.id, retailerSku: row.retailer_sku,
              retailerUrl: row.retailer_url, priceAmount: row.price_amount,
            })
            // Only a live, AVAILABLE, plausible offer comes back. Sold-out
            // editions verified truthfully and stay soft-deleted.
            if (!PURCHASABLE_KLASSES.includes(v.klass) || v.live === null) {
              if (v.klass === 'unavailable') tally.soldOut++
              else tally.failures++
              await sleep(BETWEEN_MS)
              continue
            }
            if (isImplausiblePrice(Number(row.price_amount), Number(v.live))) {
              tally.skippedImplausible++
              await sleep(BETWEEN_MS)
              continue
            }
            const now = new Date()
            const upd = await prisma.retailerListing.updateMany({
              // Scoped to the one recoverable cohort.
              where: { id: row.id, deletedAt: RECOVERABLE_SWEEP_AT },
              data: {
                deletedAt:   null,
                priceAmount: new Prisma.Decimal(v.live),
                stockStatus: 'IN_STOCK',
                lastSeenAt:  now,
              },
            })
            if (upd.count !== 1) { await sleep(BETWEEN_MS); continue }
            await prisma.priceHistory.create({
              data: {
                retailerListingId: row.id,
                priceAmount:       new Prisma.Decimal(v.live),
                priceCurrency:     'GBP',
                stockStatus:       'IN_STOCK',
                recordedAt:        now,
              },
            })
            tally.revived++
            tally.historyRows++
            await sleep(BETWEEN_MS)
          }
        }
      }

      return {
        ...tally,
        recoveryTriggered,
        failureDetail,
        productRequests: cost.productRequests,
        retryRequests:   cost.retryRequests,
        elapsedMs:       Date.now() - t0,
      }
    })

    // A run that verified nothing at all is a silent failure of exactly the
    // kind that produced B4 — say so rather than recording a green run.
    if (result.checked > 0 && result.refreshed + result.revived === 0) {
      await step.run('alert-nothing-written', () =>
        raiseAlert({
          key:      'offer-refresh-wrote-nothing',
          severity: 'critical',
          title:    'Offer refresh verified rows but wrote none',
          details: [
            `checked ${result.checked}, wrote 0`,
            `failures ${result.failures}, implausible ${result.skippedImplausible}`,
            ...result.failureDetail.slice(0, 3).map(f => `${f.klass} at ${f.endpoint}`),
          ],
          action: 'Check the retailer endpoint and the identity rules before the 30-day expiry.',
        }))
    }

    await step.run('update-job-run', () =>
      prisma.jobRun.update({
        where: { id: jobRun.id },
        data: {
          status:         'success',
          finishedAt:     new Date(),
          itemsProcessed: result.refreshed + result.revived,
          metadata:       result as unknown as Prisma.InputJsonValue,
        },
      }))

    console.log(`[offer-refresh] checked ${result.checked} · refreshed ${result.refreshed} · revived ${result.revived} · sold out ${result.soldOut} · price changes ${result.priceChanges} · failures ${result.failures}`)
    return result
  },
)
