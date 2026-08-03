/**
 * enrich.canonical_products — daily enrichment job.
 *
 * Runs at 02:00 UTC daily. Picks up to 500 canonical_products with sparse
 * metadata (missing description or cover image) that have an ISBN-13, and
 * calls enrichByIsbn() + applyEnrichment() for each.
 *
 * Uses the existing enrichPendingProducts() bulk helper which respects
 * rate limits (1 req/s Google Books without key, 1 req/s Open Library).
 * 500 products × ~1s/request ≈ 8–15 min total (well within Inngest limits).
 *
 * Results are logged to job_runs for the admin dashboard.
 */

import { inngest }               from '@/lib/inngest/client'
import { prisma }                from '@/lib/prisma'
import { enrichPendingProducts } from '@/lib/enrichment/isbn'
import { inngestCostGate }       from '@/lib/costguard/inngest'

export const enrichCanonical = inngest.createFunction(
  {
    id:       'enrich-canonical-products',
    name:     'Enrich Canonical Products',
    retries:  1,
    triggers: [{ cron: '0 2 * * *' }],   // 02:00 UTC daily
  },
  async ({ step }) => {
    // Cost Guard: catalogue enrichment is bulk external-API + DB write work.
    const costGate = await step.run('costguard-gate', () =>
      inngestCostGate({
        operation:    'inngest:enrich-canonical',
        jobClass:     'nonessential',
        estRows:      10_000,
        estRequests:  500,
        maxRuntimeMs: 20 * 60_000,
        write:        true,
      }))
    if (!costGate.allowed) {
      console.warn(`[costguard] enrich-canonical skipped: ${costGate.reason}`)
      return { skipped: 'costguard', reason: costGate.reason }
    }

    // ── Step 1: create job run ───────────────────────────────────────────────
    const jobRun = await step.run('create-job-run', () =>
      prisma.jobRun.create({
        data: { jobName: 'enrich.canonical_products', status: 'running' },
        select: { id: true },
      }),
    )

    // ── Step 2: run enrichment ───────────────────────────────────────────────
    const summary = await step.run('run-enrichment', () =>
      enrichPendingProducts(500),
    )

    console.log(
      `[enrich-canonical] done: processed=${summary.processed} ` +
      `enriched=${summary.enriched} skipped=${summary.skipped} ` +
      `notFound=${summary.notFound} errors=${summary.errors}`,
    )

    // ── Step 3: update job run ───────────────────────────────────────────────
    await step.run('update-job-run', () =>
      prisma.jobRun.update({
        where: { id: jobRun.id },
        data: {
          status:        summary.errors > 0 ? 'error' : 'success',
          finishedAt:    new Date(),
          itemsProcessed: summary.processed,
          errorSummary:  summary.errors > 0
            ? `${summary.errors} enrichment error(s) — check logs`
            : null,
          metadata: {
            enriched: summary.enriched,
            skipped:  summary.skipped,
            notFound: summary.notFound,
            errors:   summary.errors,
          },
        },
      }),
    )

    return summary
  },
)
