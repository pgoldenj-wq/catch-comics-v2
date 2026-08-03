/**
 * scripts/test-costguard.ts — Cost Guard simulations and enforcement proof.
 *
 * Run: npm run test:costguard
 *
 * No network, no paid calls, no real provider limits touched. KV env is
 * force-cleared so the store uses its local file fallback in a temp dir.
 * Follows the repo's script-test convention (test-lbb-containment.ts).
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Force file-fallback store into a throwaway dir BEFORE importing modules.
delete process.env.KV_REST_API_URL
delete process.env.KV_REST_API_TOKEN
const workDir = mkdtempSync(join(tmpdir(), 'costguard-test-'))
process.chdir(workDir)

import { COSTGUARD_CONFIG as CFG } from '../lib/costguard/config'
import { evaluate } from '../lib/costguard/engine'
import { assertJobAllowed, JobBudget, withCappedRetries } from '../lib/costguard/gate'
import { appendEvent, getEvents, setState } from '../lib/costguard/store'
import type {
  CostGuardState, ProviderUsage, Snapshot,
} from '../lib/costguard/types'
import { BudgetExceededError, JobRefusedError } from '../lib/costguard/types'

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(` ✓ ${name}`) }
  else { fail++; console.error(` ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

// ── Fixture builders ─────────────────────────────────────────────────────────

function provider(
  id: ProviderUsage['provider'],
  over: Partial<ProviderUsage> = {},
): ProviderUsage {
  return {
    provider: id, configured: true, ok: true,
    collectedAt: over.collectedAt ?? new Date().toISOString(),
    metrics: [], fixedMonthlyUsd: 0, variableMtdUsd: 0,
    ...over,
  }
}

/** Build an hourly snapshot series over `hours` ending at `end`. */
function series(
  hours: number,
  end: Date,
  build: (i: number, at: Date) => Snapshot['providers'],
  totalAt?: (i: number) => number,
): Snapshot[] {
  const snaps: Snapshot[] = []
  for (let i = 0; i < hours; i++) {
    const at = new Date(end.getTime() - (hours - 1 - i) * 3_600_000)
    const providers = build(i, at)
    snaps.push({
      at: at.toISOString(),
      monthKey: `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`,
      providers,
      totalVariableMtdUsd: totalAt
        ? totalAt(i)
        : Number(providers.reduce((s, p) => s + (p.ok ? p.variableMtdUsd : 0), 0).toFixed(2)),
      totalFixedUsd: 20,
    })
  }
  return snaps
}

const NOW = new Date('2026-08-15T12:00:00Z') // mid-month, stable maths

function normalProviders(at: Date): Snapshot['providers'] {
  const dayFrac = at.getUTCDate() + at.getUTCHours() / 24
  return [
    provider('neon', {
      collectedAt: at.toISOString(),
      variableMtdUsd: Number((1.3 * dayFrac / 31 * 31).toFixed(2)) * 0 + Number((dayFrac * 1.3).toFixed(2)),
      metrics: [
        { name: 'network_transfer_gb', mtd: Number((dayFrac * 3).toFixed(2)), unit: 'GB', estCostUsd: 0 },
        { name: 'compute_cu_hours', mtd: Number((dayFrac * 12).toFixed(1)), unit: 'CU-hr', estCostUsd: Number((dayFrac * 1.27).toFixed(2)) },
      ],
    }),
    provider('vercel', { collectedAt: at.toISOString(), fixedMonthlyUsd: 20 }),
    provider('github', {
      collectedAt: at.toISOString(),
      metrics: [{ name: 'actions_minutes', mtd: Math.round(dayFrac * 30), unit: 'min', estCostUsd: 0 }],
    }),
    provider('cloudflare', {
      collectedAt: at.toISOString(),
      metrics: [{ name: 'r2_class_a_ops', mtd: Math.round(dayFrac * 8000), unit: 'ops', estCostUsd: 0 }],
    }),
  ]
}

async function main() {
  console.log('\nCost Guard simulations\n──────────────────────')

  // 1. Normal usage → GREEN
  {
    const snaps = series(96, NOW, (_i, at) => normalProviders(at))
    const { state } = evaluate(snaps, greenPrior(), NOW)
    ok('normal usage evaluates GREEN', state.state === 'GREEN', state.reasons.join('; '))
    ok('normal projection stays under soft budget',
      state.totals.projectedMonthUsd < CFG.global.softBudgetUsd,
      `projected $${state.totals.projectedMonthUsd}`)
  }

  // 2. No snapshots at all → cannot be GREEN
  {
    const { state } = evaluate([], null, NOW)
    ok('empty telemetry can never be GREEN', state.state !== 'GREEN', state.state)
    ok('empty telemetry reports missing data reason',
      state.reasons.some(r => r.toLowerCase().includes('no usage snapshots')))
  }

  // 3. All providers unconfigured → AMBER, not GREEN
  {
    const snaps = series(24, NOW, (_i, at) => (
      (['neon', 'vercel', 'github', 'cloudflare'] as const).map(id =>
        provider(id, { configured: false, ok: false, collectedAt: at.toISOString() }))
    ))
    const { state } = evaluate(snaps, null, NOW)
    ok('unconfigured providers → AMBER (false GREEN impossible)', state.state === 'AMBER', state.state)
  }

  // 4. Stale data → AMBER
  {
    const staleEnd = new Date(NOW.getTime() - 30 * 3_600_000) // last sample 30h ago
    const snaps = series(48, staleEnd, (_i, at) => normalProviders(at))
    const { state } = evaluate(snaps, greenPrior(), NOW)
    ok('stale provider data forces AMBER', state.state === 'AMBER',
      `${state.state}: ${state.reasons.join('; ')}`)
  }

  // 5. Sudden Neon transfer spike → RED via rate threshold
  {
    const snaps = series(96, NOW, (i, at) => {
      const ps = normalProviders(at)
      const neon = ps[0]
      // Last 24 samples: transfer accelerates to ~60 GB/day (July-style)
      const spikeGb = i > 72 ? (i - 72) * 2.5 : 0
      neon.metrics = neon.metrics.map(m =>
        m.name === 'network_transfer_gb' ? { ...m, mtd: m.mtd + spikeGb } : m)
      return ps
    })
    const { state } = evaluate(snaps, greenPrior(), NOW)
    ok('Neon transfer spike (~60 GB/day) → RED', state.state === 'RED',
      `${state.state}: ${state.reasons.join('; ')}`)
  }

  // 6. Vercel spend acceleration (webhook-reported) → projected breach → RED
  {
    const snaps = series(96, NOW, (i, at) => {
      const ps = normalProviders(at)
      const vercelSpend = i > 48 ? (i - 48) * 1.5 : 0 // $36/day acceleration
      ps[1] = provider('vercel', {
        collectedAt: at.toISOString(),
        fixedMonthlyUsd: 20,
        variableMtdUsd: vercelSpend,
        metrics: [{ name: 'spend_management_reported_usd', mtd: vercelSpend, unit: 'USD', estCostUsd: vercelSpend }],
      })
      return ps
    })
    const { state } = evaluate(snaps, greenPrior(), NOW)
    ok('Vercel spend acceleration → RED', state.state === 'RED',
      `${state.state}: ${state.reasons.join('; ')}`)
  }

  // 7. Runaway GitHub Actions minutes → escalation
  {
    const snaps = series(96, NOW, (i, at) => {
      const ps = normalProviders(at)
      const mins = i > 72 ? (i - 72) * 20 : 0 // ~480 min/day
      ps[2] = provider('github', {
        collectedAt: at.toISOString(),
        metrics: [{ name: 'actions_minutes', mtd: 300 + mins, unit: 'min', estCostUsd: 0 }],
      })
      return ps
    })
    const { state } = evaluate(snaps, greenPrior(), NOW)
    ok('runaway GitHub Actions minutes → not GREEN', state.state !== 'GREEN', state.state)
  }

  // 8. R2 Class A surge → escalation
  {
    const snaps = series(96, NOW, (i, at) => {
      const ps = normalProviders(at)
      const surge = i > 72 ? (i - 72) * 15_000 : 0 // ~360k ops/day
      ps[3] = provider('cloudflare', {
        collectedAt: at.toISOString(),
        metrics: [{ name: 'r2_class_a_ops', mtd: 100_000 + surge, unit: 'ops', estCostUsd: 0 }],
      })
      return ps
    })
    const { state } = evaluate(snaps, greenPrior(), NOW)
    ok('R2 Class A operation surge → not GREEN', state.state !== 'GREEN', state.state)
  }

  // 9. Catastrophic MTD → LOCKDOWN, latched
  {
    const snaps = series(24, NOW, (_i, at) => normalProviders(at),
      i => 260 + i) // global variable MTD > $250 catastrophic
    const { state } = evaluate(snaps, greenPrior(), NOW)
    ok('catastrophic MTD → LOCKDOWN', state.state === 'LOCKDOWN', state.state)
    ok('LOCKDOWN latches', state.lockdownLatched)
    // Engine alone can never leave LOCKDOWN:
    const calm = series(96, NOW, (_i, at) => normalProviders(at))
    const { state: after } = evaluate(calm, state, NOW)
    ok('engine never un-latches LOCKDOWN', after.state === 'LOCKDOWN')
  }

  // 10. Recovery hysteresis: RED → … → GREEN only after clean streak
  {
    let prior = redPrior()
    let sawImmediateGreen = false
    for (let h = 0; h < 20; h++) {
      const at = new Date(NOW.getTime() + h * 3_600_000)
      const snaps = series(96, at, (_i, sAt) => normalProviders(sAt))
      const { state } = evaluate(snaps, prior, at)
      if (h === 0 && state.state === 'GREEN') sawImmediateGreen = true
      prior = state
    }
    ok('recovery needs a clean streak (no instant GREEN)', !sawImmediateGreen)
    ok('sustained clean samples eventually recover to GREEN', prior.state === 'GREEN', prior.state)
  }

  // ── Gate enforcement ───────────────────────────────────────────────────────
  console.log('\nGate enforcement\n────────────────')

  const baseSpec = {
    operation: 'script:backfill-covers',
    jobClass: 'high-risk' as const,
    estRows: 5000, estRequests: 1000, maxRuntimeMs: 3_600_000, write: true,
  }

  await setState(mkState('GREEN'))
  let allowed = true
  try { await assertJobAllowed(baseSpec) } catch { allowed = false }
  ok('high-risk job WITH limits runs in GREEN', allowed)

  await setState(mkState('RED'))
  let refused = false
  try { await assertJobAllowed({ ...baseSpec, operation: 'inngest:sync-retailer', jobClass: 'nonessential' }) }
  catch (e) { refused = e instanceof JobRefusedError }
  ok('nonessential job refused in RED', refused)

  let deferrableOk = true
  try { await assertJobAllowed({ operation: 'inngest:price-check', jobClass: 'deferrable', write: true }) }
  catch { deferrableOk = false }
  ok('deferrable job still runs in RED', deferrableOk)

  await setState(mkState('LOCKDOWN', true))
  let bulkRefused = false
  try { await assertJobAllowed(baseSpec) } catch (e) { bulkRefused = e instanceof JobRefusedError }
  ok('bulk write refused in LOCKDOWN', bulkRefused)

  let essentialOk = true
  try { await assertJobAllowed({ operation: 'essential:probe', jobClass: 'essential', write: false }) }
  catch { essentialOk = false }
  ok('essential operation allowed even in LOCKDOWN', essentialOk)

  await setState(mkState('AMBER'))
  let unboundedRefused = false
  try { await assertJobAllowed({ operation: 'script:new-bulk', jobClass: 'nonessential', write: true }) }
  catch (e) { unboundedRefused = e instanceof JobRefusedError }
  ok('AMBER refuses bulk job without explicit limits', unboundedRefused)

  let boundedOk = true
  try {
    await assertJobAllowed({
      operation: 'script:new-bulk', jobClass: 'nonessential', write: true,
      estRows: 100, estRequests: 10, maxRuntimeMs: 60_000,
    })
  } catch { boundedOk = false }
  ok('AMBER allows the same job once limits are declared', boundedOk)

  // Refusals recorded with evidence
  {
    const events = await getEvents()
    const refusal = events.filter(e => e.kind === 'job-refused').pop()
    ok('refusal events carry trigger/threshold/action evidence',
      Boolean(refusal?.detail?.trigger && refusal?.detail?.action && refusal?.detail?.guardState))
  }

  // JobBudget runtime ceilings
  {
    const budget = new JobBudget({ operation: 't', jobClass: 'high-risk', estRows: 10, write: true })
    let threw = false
    try { for (let i = 0; i < 12; i++) budget.countRow() } catch (e) { threw = e instanceof BudgetExceededError }
    ok('JobBudget aborts when row ceiling crossed', threw)
  }

  // Capped retries
  {
    let attempts = 0
    let failedProperly = false
    try {
      await withCappedRetries('t', async () => { attempts++; throw new Error('boom') },
        { maxAttempts: 3, baseDelayMs: 1 })
    } catch { failedProperly = true }
    ok('withCappedRetries stops at the cap', failedProperly && attempts === 3, `attempts=${attempts}`)
  }

  // Alert dedupe
  {
    const ev = {
      at: new Date().toISOString(), kind: 'alert' as const,
      dedupeKey: 'dup-test', message: 'same alert',
    }
    const first = await appendEvent(ev, CFG.alertDedupeWindowMs)
    const second = await appendEvent({ ...ev, at: new Date().toISOString() }, CFG.alertDedupeWindowMs)
    ok('duplicate alerts inside the window are suppressed', first === true && second === false)
  }

  // ── Secret hygiene: no client-side imports of costguard modules ────────────
  {
    const repoRoot = process.env.COSTGUARD_TEST_REPO_ROOT
    if (repoRoot) {
      let violations = 0
      const scan = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, entry.name)
          if (entry.isDirectory()) { scan(p); continue }
          if (!/\.(tsx?|jsx?)$/.test(entry.name)) continue
          const src = readFileSync(p, 'utf8')
          if (src.includes("'use client'") && src.includes('costguard')) violations++
        }
      }
      scan(join(repoRoot, 'components'))
      scan(join(repoRoot, 'app'))
      ok('no client component imports costguard modules', violations === 0, `${violations} violations`)
    } else {
      console.log(' (skipped client-import scan — COSTGUARD_TEST_REPO_ROOT not set)')
    }
  }

  console.log(`\n${pass} passed · ${fail} failed`)
  if (fail > 0) process.exitCode = 1
}

// ── State fixtures ───────────────────────────────────────────────────────────

function mkState(s: CostGuardState['state'], latched = false): CostGuardState {
  const now = new Date().toISOString()
  return {
    state: s, since: now, reasons: [`fixture ${s}`], lockdownLatched: latched,
    updatedAt: now, lastCollectionAt: now, staleProviders: [], unconfiguredProviders: [],
    totals: { variableMtdUsd: 10, fixedMonthlyUsd: 20, projectedMonthUsd: 30, burnUsdPerDay: 1, baselineUsdPerDay: 1 },
    perProvider: [], activeRestrictions: [], counters: { abnormalSamples: 0, cleanSamples: 0 },
  }
}
function greenPrior() { return mkState('GREEN') }
function redPrior() { const st = mkState('RED'); st.counters = { abnormalSamples: 3, cleanSamples: 0 }; return st }

main()
  .catch(err => { console.error('test-costguard crashed:', err); process.exitCode = 1 })
  .finally(() => { try { rmSync(workDir, { recursive: true, force: true }) } catch { /* Windows lock */ } })
