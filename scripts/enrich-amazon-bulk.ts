#!/usr/bin/env tsx
/**
 * enrich-amazon-bulk.ts
 *
 * Bulk pre-enrichment of Amazon UK prices for TM-linked canonicals.
 *
 * ══════════════════════════════════════════════════════════
 * ⚠  COST WARNING — READ BEFORE RUNNING
 * ══════════════════════════════════════════════════════════
 * Rainforest API Hobbyist plan overage rate: $0.092/request
 * Default --budget cap: $5.00 (≈54 requests at overage rate)
 *
 * ALWAYS run dry-run first to see cost projection.
 * ALWAYS disable overage on Rainforest account:
 *   https://app.rainforestapi.com/ → Billing → Overage: OFF
 *
 * With overage DISABLED, the 402 quota guard hard-stops the run.
 * With overage ENABLED, every request charges $0.092 without stopping.
 * ══════════════════════════════════════════════════════════
 *
 * Strategy:
 *   For every TM-linked canonical with an ISBN-13 that has no Amazon UK listing
 *   (or a stale one > TTL_HOURS old), call Rainforest API (GTIN lookup) and
 *   save the result via the existing upsertAmazonListing path.
 *
 * Rate limiting:
 *   Rainforest standard tier: our in-app cap is 10/min.
 *   This script uses DELAY_MS = 6500ms between calls (≈9.2/min, safely under).
 *   Each iteration also checks canCallRainforest() before firing.
 *
 * Cost reality (Hobbyist plan, May 2026):
 *   Overage rate: $0.092/call (NOT $0.001 — that is enterprise-tier only)
 *   Bundled credits: ~250–500/month
 *   Safe batch size: 50–100 calls max before checking spend
 *   Full catalogue (~9,100 ISBNs): ~$837 at overage rate — DO NOT RUN UNBOUNDED
 *
 * Usage:
 *   npm run enrich:amazon               dry-run, limit 50
 *   npm run enrich:amazon -- --write    write to DB, limit 50
 *   npm run enrich:amazon -- --write --limit 100 --budget 5
 *   npm run enrich:amazon -- --write --limit 0 --budget 20   (budget-capped)
 *   npm run enrich:amazon -- --write --stale 720   re-enrich listings >30d old
 *
 * Env vars required:
 *   RAINFOREST_API_KEY  — from app.rainforestapi.com
 *   DATABASE_URL        — Supabase connection string (via .env.local)
 */

import { prisma }                              from '../lib/prisma'
import { lookupByIsbn, RainforestQuotaError } from '../lib/adapters/amazon-rainforest'

// ── CLI args ──────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2)
const WRITE   = args.includes('--write')

const limIdx  = args.indexOf('--limit')
const RAW_LIM = limIdx !== -1 ? parseInt(args[limIdx + 1] ?? '50', 10) : 50   // default lowered to 50
const LIMIT   = RAW_LIM === 0 ? 999_999 : RAW_LIM

const staleIdx  = args.indexOf('--stale')
// Default TTL raised to 720h (30 days) for bulk enrichment.
// 6h TTL is appropriate only for real-time on-demand lookups, not batch runs.
// At $0.092/call overage, re-enriching every 6h is $441/day per 1,200 listings.
const TTL_HOURS = staleIdx !== -1 ? parseInt(args[staleIdx + 1] ?? '720', 10) : 720

// ── Spending cap ──────────────────────────────────────────────────────────────
// Hard stop when projected spend exceeds this amount.
// Assumes overage rate ($0.092) as the conservative/safe estimate.
// Pass --budget 0 to disable (not recommended).
const budgetIdx     = args.indexOf('--budget')
const BUDGET_USD    = budgetIdx !== -1 ? parseFloat(args[budgetIdx + 1] ?? '5') : 5
const COST_PER_CALL = 0.092   // Hobbyist overage rate — real cost, not $0.001 marketing rate

// Rate limit: Rainforest API cap is 10/min (our process-local sliding window).
// 6500ms = ~9.2 calls/min — safely under the 10/min limit.
const DELAY_MS = 6_500

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

function fmtElapsed(startMs: number): string {
  const s = Math.round((Date.now() - startMs) / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.RAINFOREST_API_KEY
  const maxCallsForBudget = BUDGET_USD > 0 ? Math.floor(BUDGET_USD / COST_PER_CALL) : 999_999
  const effectiveLimit    = Math.min(LIMIT, maxCallsForBudget)

  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' Amazon UK Bulk Enrichment via Rainforest API')
  console.log(` Mode        : ${WRITE ? 'WRITE' : 'DRY-RUN'}`)
  console.log(` Limit       : ${LIMIT === 999_999 ? 'unlimited' : LIMIT}`)
  console.log(` Stale TTL   : ${TTL_HOURS}h (skip listings fresher than this)`)
  console.log(` Rate        : 1 call per ${DELAY_MS / 1000}s (~${(60_000 / DELAY_MS).toFixed(1)}/min)`)
  console.log(` API key     : ${apiKey ? `${apiKey.slice(0, 8)}…` : 'NOT SET ⚠ (dry-run only)'}`)
  console.log(` Cost/call   : $${COST_PER_CALL} (Hobbyist overage rate — disable overage on Rainforest!)`)
  if (BUDGET_USD > 0) {
    console.log(` Budget cap  : $${BUDGET_USD.toFixed(2)} → max ${maxCallsForBudget} calls before hard stop`)
  } else {
    console.log(` Budget cap  : DISABLED ⚠`)
  }
  if (!apiKey && WRITE) {
    console.error('\n  ✗ RAINFOREST_API_KEY is not set. Set it in .env.local and retry.')
    process.exit(1)
  }
  console.log('══════════════════════════════════════════════════════════\n')

  // Find the Amazon UK retailer id (may not exist yet — first lookup creates it)
  const amazonRetailer = await prisma.retailer.findUnique({
    where: { domain: 'amazon.co.uk' },
    select: { id: true },
  })
  const amazonRetailerId = amazonRetailer?.id ?? null

  // ── Load candidates ────────────────────────────────────────────────────────
  // Canonical products linked to TM + have an ISBN + either:
  //   a) No Amazon UK listing at all, OR
  //   b) Amazon listing older than TTL_HOURS
  const staleThreshold = new Date(Date.now() - TTL_HOURS * 3_600_000)

  // Query TM-linked ISBNs first
  const tmLinked = await prisma.$queryRaw<Array<{ id: string; isbn13: string; title: string }>>`
    SELECT DISTINCT cp.id, cp.isbn_13 AS isbn13, cp.title
    FROM canonical_products cp
    JOIN retailer_listings rl ON rl.canonical_product_id = cp.id
    JOIN retailers r ON r.id = rl.retailer_id
    WHERE r.domain = 'travellingman.com'
      AND rl.price_amount > 0
      AND rl.deleted_at IS NULL
      AND cp.deleted_at IS NULL
      AND cp.isbn_13 IS NOT NULL
    ORDER BY cp.title ASC
  `

  // Filter: exclude those with a fresh Amazon listing
  let freshCount = 0
  let candidates = tmLinked
  if (amazonRetailerId) {
    const freshAmazon = await prisma.retailerListing.findMany({
      where: {
        retailerId : amazonRetailerId,
        deletedAt  : null,
        lastSeenAt : { gt: staleThreshold },
        priceAmount: { gt: 0 },
      },
      select: { canonicalProductId: true },
    })
    const freshSet = new Set(freshAmazon.map(l => l.canonicalProductId))
    freshCount = freshSet.size
    candidates = tmLinked.filter(c => !freshSet.has(c.id))
  }

  const totalEligible = candidates.length
  candidates = candidates.slice(0, effectiveLimit)

  // How many already have Amazon pricing (total, including stale)
  const alreadyPriced = amazonRetailerId
    ? await prisma.retailerListing.count({
        where: { retailerId: amazonRetailerId, deletedAt: null, priceAmount: { gt: 0 } },
      })
    : 0

  console.log(`  TM-linked ISBNs    : ${tmLinked.length}`)
  console.log(`  Already priced     : ${alreadyPriced} (Amazon UK in DB, incl. stale)`)
  console.log(`  Fresh (< ${TTL_HOURS}h)     : ${freshCount} (skipped — within TTL)`)
  console.log(`  Eligible to enrich : ${totalEligible}`)
  console.log(`  This run (limit)   : ${candidates.length}  (budget cap: $${BUDGET_USD > 0 ? BUDGET_USD.toFixed(2) : 'none'} → ${maxCallsForBudget} calls max)`)
  console.log(`  Est. cost          : $${(candidates.length * COST_PER_CALL).toFixed(2)}  @ $${COST_PER_CALL}/call (overage rate)`)
  const estMinutes = Math.ceil(candidates.length * DELAY_MS / 60_000)
  console.log(`  Est. time          : ~${estMinutes} min`)

  if (candidates.length === 0) {
    console.log('\n  Nothing to do — all TM-linked ISBNs have fresh Amazon pricing.\n')
    return
  }

  if (!WRITE) {
    console.log('\n  (dry-run) Pass --write to execute.')
    console.log('\n  First 5 candidates:')
    for (const c of candidates.slice(0, 5)) {
      console.log(`    ${c.isbn13}  ${c.title.slice(0, 60)}`)
    }
    console.log('\n══════════════════════════════════════════════════════════\n')
    return
  }

  // ── Enrichment loop ────────────────────────────────────────────────────────
  const start          = Date.now()
  let priced           = 0
  let notFound         = 0
  let errors           = 0
  let rateMiss         = 0
  let quotaExhausted   = false
  let tooManyErrors    = false
  let budgetHit        = false
  let callsMade        = 0

  console.log('\n  Starting enrichment loop...\n')

  for (let i = 0; i < candidates.length; i++) {
    const canon   = candidates[i]
    const pct     = ((i / candidates.length) * 100).toFixed(0)
    const elapsed = fmtElapsed(start)

    const spentSoFar = callsMade * COST_PER_CALL
    process.stdout.write(
      `  [${String(i + 1).padStart(4)}/${candidates.length}] ${pct}% | ${elapsed} | $${spentSoFar.toFixed(2)} spent | ` +
      `${canon.isbn13} | ${canon.title.slice(0, 35).padEnd(35)}\r`
    )

    // Hard budget check before each call
    if (BUDGET_USD > 0 && spentSoFar >= BUDGET_USD) {
      process.stdout.write('\n')
      console.log(`\n  ✋ BUDGET CAP REACHED: $${spentSoFar.toFixed(2)} spent (cap: $${BUDGET_USD.toFixed(2)})`)
      console.log(`     Pass --budget ${(BUDGET_USD * 2).toFixed(0)} to double the cap, or --budget 0 to disable.`)
      budgetHit = true
      break
    }

    try {
      const offer = await lookupByIsbn(canon.isbn13, canon.id, 'amazon.co.uk')
      callsMade++

      if (offer && offer.priceAmount > 0) {
        priced++
      } else if (offer === null) {
        notFound++
      } else {
        notFound++  // price=0 = OOS or no buybox
      }
    } catch (err) {
      if (err instanceof RainforestQuotaError) {
        process.stdout.write('\n')
        console.error('\n  ✗ QUOTA EXHAUSTED (HTTP 402) — Rainforest credits used up.')
        console.error('    ⚠  If you are seeing this, overage is DISABLED on your account (good).')
        console.error('    ⚠  If you are NOT seeing 402 but still being charged, DISABLE overage at:')
        console.error('         https://app.rainforestapi.com/ → Billing → Overage: OFF')
        console.error(`    Priced before stop : ${priced}`)
        console.error(`    Spent before stop  : $${(callsMade * COST_PER_CALL).toFixed(2)}`)
        console.error(`    Remaining retryable: ${candidates.length - i - 1} ISBNs (safe to re-run once billing is resolved)`)
        console.error('    Already-priced ISBNs will be skipped on next run (TTL window).')
        quotaExhausted = true
        break
      }
      errors++
      process.stdout.write('\n')
      console.error(`  [error] ${canon.isbn13}: ${(err as Error).message}`)
      if (errors > 10) {
        console.error('\n  Too many errors — aborting.')
        tooManyErrors = true
        break
      }
    }

    // Keep-alive ping for Supabase idle connection (needed for long runs)
    if (i % 5 === 0) {
      await prisma.$queryRaw`SELECT 1`.catch(() => { /* ignore */ })
    }

    // Rate limit delay between calls (skip after the last one)
    if (i < candidates.length - 1) {
      await sleep(DELAY_MS)
    }
  }

  process.stdout.write('\n')
  const yieldPct = candidates.length > 0 ? ((priced / candidates.length) * 100).toFixed(0) : '0'

  const actualCost = callsMade * COST_PER_CALL
  console.log('\n── Summary ──────────────────────────────────────────────')
  console.log(`  Attempted : ${callsMade} API calls made`)
  console.log(`  Priced    : ${priced}  (${yieldPct}% yield)`)
  console.log(`  Not found : ${notFound}`)
  console.log(`  Rate miss : ${rateMiss}`)
  console.log(`  Errors    : ${errors}`)
  console.log(`  Elapsed   : ${fmtElapsed(start)}`)
  console.log(`  API cost  : ~$${actualCost.toFixed(2)}  (${callsMade} calls × $${COST_PER_CALL}/call overage rate)`)
  if (budgetHit) console.log(`  Budget    : CAP REACHED at $${BUDGET_USD.toFixed(2)}`)

  if (priced > 0) {
    console.log(`\n  ✓ Added Amazon UK pricing to ${priced} product pages.`)
  } else {
    console.log('\n  ⚠ Zero priced — check RAINFOREST_API_KEY and account credits.')
    console.log('    Inspect api_usage_log: SELECT * FROM api_usage_logs ORDER BY id DESC LIMIT 10;')
  }

  console.log('\n  Next: if yield > 50%, schedule a nightly cron via Vercel Cron:')
  console.log('    GET /api/cron/amazon-refresh — refreshes stale listings in batches')
  console.log('══════════════════════════════════════════════════════════\n')

  // ── Machine-readable result (parsed by enrich-overnight.ts orchestrator) ──
  const batchStatus = quotaExhausted ? 'quota_exhausted'
                    : tooManyErrors  ? 'too_many_errors'
                    : budgetHit      ? 'budget_cap'
                    : candidates.length === 0 ? 'nothing_to_do'
                    : 'ok'
  console.log(`BATCH_RESULT:${JSON.stringify({ attempted: callsMade, priced, notFound, errors, cost: parseFloat(actualCost.toFixed(3)), status: batchStatus })}`)

  // Exit codes:
  //   0 = normal (ok or nothing_to_do)
  //   2 = quota exhausted — orchestrator should stop immediately
  //   3 = too many errors — orchestrator should stop and alert
  //   4 = budget cap hit — orchestrator should stop and report
  if (quotaExhausted) process.exit(2)
  if (tooManyErrors)  process.exit(3)
  if (budgetHit)      process.exit(4)
}

main().catch(console.error).finally(() => prisma.$disconnect())
