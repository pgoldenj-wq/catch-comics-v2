#!/usr/bin/env tsx
/**
 * enrich-overnight.ts
 *
 * ══════════════════════════════════════════════════════════
 * ⚠  COST WARNING — READ BEFORE RUNNING
 * ══════════════════════════════════════════════════════════
 * Rainforest API Hobbyist plan overage: $0.092/request
 * This orchestrator enforces a TOTAL BUDGET CAP across all batches.
 * Default total budget: $10 (≈108 calls at overage rate)
 *
 * BEFORE RUNNING: Disable overage on your Rainforest account:
 *   https://app.rainforestapi.com/ → Billing → Overage: OFF
 * ══════════════════════════════════════════════════════════
 *
 * Overnight orchestrator for Amazon UK enrichment.
 *
 * Runs enrich-amazon-bulk.ts in repeated batches until:
 *   (a) the catalogue is exhausted (no fresh ISBNs left to enrich)
 *   (b) Rainforest quota is hit (402 → exit code 2)
 *   (c) too many consecutive API errors (exit code 3)
 *   (d) budget cap hit (exit code 4) — total $$ across all batches
 *   (e) --max-batches reached
 *   (f) you press Ctrl+C
 *
 * Usage:
 *   npm run enrich:overnight                              # dry-run preview only
 *   npm run enrich:overnight -- --budget 5               # max $5 total
 *   npm run enrich:overnight -- --batch 50 --budget 5    # 50/batch, $5 total cap
 *   npm run enrich:overnight -- --max-batches 5 --budget 10
 *
 * Stop it:   Ctrl+C  (waits for current batch to finish cleanly)
 * Log file:  logs/amazon-enrich-YYYY-MM-DD.log  (also printed to console)
 */

import { spawn }      from 'child_process'
import * as fs        from 'fs'
import * as path      from 'path'

// ── CLI args ──────────────────────────────────────────────────────────────────
const args         = process.argv.slice(2)

const batchIdx     = args.indexOf('--batch')
const BATCH_SIZE   = batchIdx  !== -1 ? parseInt(args[batchIdx  + 1] ?? '50',  10) : 50   // default 50

const maxIdx       = args.indexOf('--max-batches')
const MAX_BATCHES  = maxIdx    !== -1 ? parseInt(args[maxIdx    + 1] ?? '10',  10) : 10   // default 10

const budgetIdx    = args.indexOf('--budget')
// Default total budget: $10. Orchestrator stops when all batches combined exceed this.
// Per-batch budget = TOTAL_BUDGET / MAX_BATCHES (each batch also enforces its own cap).
const TOTAL_BUDGET = budgetIdx !== -1 ? parseFloat(args[budgetIdx + 1] ?? '10') : 10
const COST_PER_CALL = 0.092

// Pause between batches (ms). 90s gives Supabase connection a breather and
// lets any rate-limit window fully reset before the next batch starts.
const PAUSE_MS     = 90_000

// ── Logging ───────────────────────────────────────────────────────────────────
const logsDir  = path.join(process.cwd(), 'logs')
fs.mkdirSync(logsDir, { recursive: true })

const today    = new Date().toISOString().slice(0, 10)
const logFile  = path.join(logsDir, `amazon-enrich-${today}.log`)
const logStream = fs.createWriteStream(logFile, { flags: 'a' })

function log(msg: string) {
  const ts   = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const line = `[${ts}] ${msg}`
  console.log(line)
  logStream.write(line + '\n')
}

function logRaw(msg: string) {
  process.stdout.write(msg)
  logStream.write(msg)
}

function logSep(char = '─', len = 58) { log(char.repeat(len)) }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

function fmtTime(date: Date): string {
  return date.toTimeString().slice(0, 8)
}

interface BatchResult {
  attempted : number
  priced    : number
  notFound  : number
  errors    : number
  cost?     : number   // actual spend in USD (callsMade × $0.092)
  status    : 'ok' | 'quota_exhausted' | 'too_many_errors' | 'budget_cap' | 'nothing_to_do' | 'unknown'
}

// ── Run a single batch ────────────────────────────────────────────────────────

function runBatch(batchSize: number, budgetUsd: number): Promise<{ exitCode: number; result: BatchResult | null; output: string }> {
  return new Promise(resolve => {
    const budgetArgs = budgetUsd > 0 ? ['--budget', budgetUsd.toFixed(2)] : ['--budget', '0']
    // Use dotenv-cli to load .env.local — same as npm run enrich:amazon
    const proc = spawn(
      'npx',
      ['dotenv', '-e', '.env.local', '--', 'tsx', 'scripts/enrich-amazon-bulk.ts', '--write',
       '--limit', String(batchSize), ...budgetArgs],
      {
        cwd:   process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      }
    )

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stdout += text
      // Stream non-\r lines to the log; skip the inline \r progress spinner
      // (those have \r but no \n — they update the same line in a real terminal).
      const lines = text.split('\n')
      lines.forEach((line, i) => {
        // Skip the last empty fragment (it's the incomplete current line)
        if (i === lines.length - 1 && !line.includes('\n')) return
        if (line.includes('\r') && !line.includes('Starting enrichment')) return
        if (line.trim()) logRaw(`  │  ${line}\n`)
      })
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderr += text
      text.split('\n').filter(l => l.trim()).forEach(l => logRaw(`  │  ⚠ ${l}\n`))
    })

    proc.on('close', exitCode => {
      // Parse BATCH_RESULT JSON from the last line of output
      const resultMatch = stdout.match(/BATCH_RESULT:(\{.+?\})/)
      let result: BatchResult | null = null
      if (resultMatch) {
        try {
          result = JSON.parse(resultMatch[1]) as BatchResult
        } catch { /* ignore */ }
      }
      resolve({ exitCode: exitCode ?? 1, result, output: stdout + stderr })
    })
  })
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const runStart     = Date.now()
  let totalAttempted = 0
  let totalPriced    = 0
  let totalNotFound  = 0
  let totalCost      = 0
  let batchesOk      = 0
  let stopReason     = 'unknown'
  let stopping       = false

  // Graceful Ctrl+C: wait for the current batch to finish, then summarise.
  process.on('SIGINT', () => {
    if (!stopping) {
      stopping    = true
      stopReason  = 'user_interrupted'
      log('\n  Ctrl+C received — waiting for current batch to finish...')
      log('  (kill the process again to force-stop immediately)')
    } else {
      process.exit(130)
    }
  })

  const maxCallsTotal     = TOTAL_BUDGET > 0 ? Math.floor(TOTAL_BUDGET / COST_PER_CALL) : 999_999
  const perBatchBudget    = TOTAL_BUDGET > 0 ? (TOTAL_BUDGET / MAX_BATCHES).toFixed(2) : '0'
  const worstCaseCost     = (BATCH_SIZE * MAX_BATCHES * COST_PER_CALL).toFixed(2)
  const estMinutes        = Math.ceil(BATCH_SIZE * (6.5 / 60) * MAX_BATCHES)

  logSep('═')
  log(' Catch Comics — Overnight Amazon UK Enrichment')
  log(` Batch size    : ${BATCH_SIZE} ISBNs per batch`)
  log(` Max batches   : ${MAX_BATCHES}`)
  log(` Total budget  : $${TOTAL_BUDGET > 0 ? TOTAL_BUDGET.toFixed(2) : 'NONE ⚠'} max (≈${maxCallsTotal} calls at $${COST_PER_CALL}/call overage)`)
  log(` Per-batch cap : ~$${perBatchBudget}`)
  log(` Worst-case $  : $${worstCaseCost} (${BATCH_SIZE * MAX_BATCHES} calls if all overage)`)
  log(` Est. time     : ~${Math.floor(estMinutes / 60)}h ${estMinutes % 60}m worst-case`)
  log(` Pause         : ${PAUSE_MS / 1000}s between batches`)
  log(` Log file      : ${path.relative(process.cwd(), logFile)}`)
  logSep()
  log(' ⚠  Ensure overage is DISABLED on Rainforest: https://app.rainforestapi.com/')
  logSep('═')
  log('')

  for (let batch = 1; batch <= MAX_BATCHES; batch++) {
    if (stopping) break

    logSep()
    log(` Batch ${String(batch).padStart(2)} / ${MAX_BATCHES}  —  starting`)
    const batchStart = Date.now()

    // Remaining budget for this batch
    const remainingBudget = TOTAL_BUDGET > 0 ? Math.max(0, TOTAL_BUDGET - totalCost) : 0
    if (TOTAL_BUDGET > 0 && remainingBudget <= 0) {
      log(`  ✋ Total budget cap reached ($${totalCost.toFixed(2)} of $${TOTAL_BUDGET.toFixed(2)}) — stopping before batch ${batch}`)
      stopReason = 'total_budget_cap'
      break
    }

    const { exitCode, result } = await runBatch(BATCH_SIZE, remainingBudget)

    const batchMs = Date.now() - batchStart

    if (!result) {
      log(`  ✗ Batch ${batch} — no result parsed (exit code ${exitCode}). Treating as fatal.`)
      stopReason = 'parse_error'
      break
    }

    // ── Report batch outcome ─────────────────────────────────────────────────
    totalAttempted += result.attempted
    totalPriced    += result.priced
    totalNotFound  += result.notFound
    totalCost      += result.cost ?? (result.attempted * COST_PER_CALL)

    const yieldPct = result.attempted > 0
      ? `${((result.priced / result.attempted) * 100).toFixed(0)}%`
      : '—'

    if (result.status === 'nothing_to_do') {
      log(`  ✓ Batch ${batch} — nothing left to enrich (catalogue exhausted for this TTL window)`)
      stopReason = 'catalogue_exhausted'
      break
    }

    log(`  Batch ${batch} done in ${fmtDuration(batchMs)}`)
    log(`    Attempted : ${result.attempted}`)
    log(`    Priced    : ${result.priced}  (${yieldPct} yield)`)
    log(`    Not found : ${result.notFound}`)
    log(`    Errors    : ${result.errors}`)
    log(`    Batch cost: ~$${(result.cost ?? result.attempted * COST_PER_CALL).toFixed(2)}`)
    log(`    Total cost: ~$${totalCost.toFixed(2)} of $${TOTAL_BUDGET > 0 ? TOTAL_BUDGET.toFixed(2) : '∞'} budget`)
    log(`    Cumulative: ${totalPriced.toLocaleString()} priced from ${totalAttempted.toLocaleString()} attempted`)

    // ── Stop conditions ──────────────────────────────────────────────────────
    if (exitCode === 2 || result.status === 'quota_exhausted') {
      log('')
      log('  ✗ QUOTA EXHAUSTED — Rainforest credits used up.')
      log('    This means overage is correctly DISABLED on your account. Good.')
      log('    Action: top up included credits or wait for billing cycle reset.')
      log('    Safe to resume — enriched ISBNs will be skipped (30d TTL).')
      stopReason = 'quota_exhausted'
      break
    }

    if (exitCode === 4 || result.status === 'budget_cap') {
      log('')
      log(`  ✋ BUDGET CAP — batch hit its per-batch spending limit.`)
      log(`     Total spent: ~$${totalCost.toFixed(2)}`)
      stopReason = 'budget_cap'
      break
    }

    if (exitCode === 3 || result.status === 'too_many_errors') {
      log('')
      log('  ✗ TOO MANY ERRORS — aborting to avoid wasted API calls.')
      log('    Check RAINFOREST_API_KEY and your internet connection.')
      stopReason = 'too_many_errors'
      break
    }

    if (exitCode !== 0) {
      log(`  ✗ Unexpected exit code ${exitCode} — stopping.`)
      stopReason = `exit_${exitCode}`
      break
    }

    batchesOk++

    // ── Pause before next batch ──────────────────────────────────────────────
    if (batch < MAX_BATCHES && !stopping) {
      const nextAt = new Date(Date.now() + PAUSE_MS)
      log(`  Pausing ${PAUSE_MS / 1000}s... next batch starts at ${fmtTime(nextAt)}`)
      await new Promise<void>(resolve => {
        const t = setTimeout(resolve, PAUSE_MS)
        // Allow the pause to be interrupted by Ctrl+C
        const check = setInterval(() => { if (stopping) { clearTimeout(t); clearInterval(check); resolve() } }, 500)
        t.unref?.()
      })
    }
  }

  if (!stopping && stopReason === 'unknown') stopReason = 'max_batches_reached'

  // ── Final summary ────────────────────────────────────────────────────────────
  const totalMs    = Date.now() - runStart
  const overallPct = totalAttempted > 0
    ? `${((totalPriced / totalAttempted) * 100).toFixed(0)}%`
    : '—'

  log('')
  logSep('═')
  log(' OVERNIGHT RUN COMPLETE')
  logSep('─')
  log(` Batches completed : ${batchesOk}`)
  log(` ISBNs attempted   : ${totalAttempted.toLocaleString()}`)
  log(` ISBNs priced      : ${totalPriced.toLocaleString()}  (${overallPct} yield)`)
  log(` Not found         : ${totalNotFound.toLocaleString()}`)
  log(` Total elapsed     : ${fmtDuration(totalMs)}`)
  log(` API cost          : ~$${totalCost.toFixed(2)}  (${totalAttempted} calls × $${COST_PER_CALL}/call)`)
  log(` Budget cap        : $${TOTAL_BUDGET > 0 ? TOTAL_BUDGET.toFixed(2) : 'none'}`)
  log(` Stopped because   : ${stopReason}`)
  log(` Log file          : ${logFile}`)

  if (stopReason === 'quota_exhausted') {
    log('')
    log(' NEXT STEPS:')
    log('   1. Top up Rainforest credits at https://app.rainforestapi.com/')
    log('   2. Run again tomorrow — enriched ISBNs will be skipped (6h TTL)')
    log('   3. Run: npm run dashboard   to see updated comparison density')
  } else if (stopReason === 'catalogue_exhausted') {
    log('')
    log(' ALL DONE! Catalogue exhausted for this TTL window.')
    log('   Run: npm run dashboard   to see updated comparison density')
    log('   Listings will be refreshed automatically as TTL expires (6h).')
  } else {
    log('')
    log('   Run: npm run dashboard   to see updated comparison density')
  }

  logSep('═')
  logStream.end()
}

main().catch(err => {
  console.error('Fatal orchestrator error:', err)
  process.exit(1)
})
