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
import { granularityLadder, parseNeonConsumption } from '../lib/costguard/providers/neon'
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

  // 6. Vercel spend acceleration (webhook-reported) → projected breach → RED.
  // Calibrated to the $25 on-demand budget band (soft 10 / max 20 / cat 25):
  // MTD stays under the catastrophic figure so this exercises the RED rung,
  // not LOCKDOWN.
  {
    const snaps = series(96, NOW, (i, at) => {
      const ps = normalProviders(at)
      const vercelSpend = i > 48 ? (i - 48) * 0.3 : 0 // ends ≈ $14 MTD, ≈ $4.7/day
      ps[1] = provider('vercel', {
        collectedAt: at.toISOString(),
        fixedMonthlyUsd: 20,
        variableMtdUsd: vercelSpend,
        metrics: [{ name: 'spend_management_reported_usd', mtd: vercelSpend, unit: 'USD', estCostUsd: vercelSpend }],
      })
      return ps
    })
    const { state } = evaluate(snaps, greenPrior(), NOW)
    ok('Vercel spend acceleration under the cap → RED', state.state === 'RED',
      `${state.state}: ${state.reasons.join('; ')}`)
    const vercelMtd = state.perProvider.find(p => p.provider === 'vercel')?.variableMtdUsd ?? 0
    ok('Vercel RED case stays below the catastrophic figure',
      vercelMtd < CFG.providers.vercel.catastrophicUsd,
      `vercel mtd $${vercelMtd} vs cat $${CFG.providers.vercel.catastrophicUsd}`)
  }

  // 6b. Vercel spend past the $25 on-demand budget → LOCKDOWN. Vercel's own
  // Production pause is deliberately OFF, so these breakers are the only thing
  // that stops at the budget.
  {
    const snaps = series(96, NOW, (i, at) => {
      const ps = normalProviders(at)
      const vercelSpend = i > 48 ? (i - 48) * 1.5 : 0 // ends ≈ $70 MTD, well past $25
      ps[1] = provider('vercel', {
        collectedAt: at.toISOString(),
        fixedMonthlyUsd: 20,
        variableMtdUsd: vercelSpend,
        metrics: [{ name: 'spend_management_reported_usd', mtd: vercelSpend, unit: 'USD', estCostUsd: vercelSpend }],
      })
      return ps
    })
    const { state } = evaluate(snaps, greenPrior(), NOW)
    ok('Vercel MTD past the $25 budget → LOCKDOWN', state.state === 'LOCKDOWN',
      `${state.state}: ${state.reasons.join('; ')}`)
    ok('LOCKDOWN latches on the Vercel budget breach', state.lockdownLatched)
  }

  // 7. Runaway GitHub Actions minutes → escalation
  {
    const snaps = series(96, NOW, (i, at) => {
      const ps = normalProviders(at)
      const mins = i > 72 ? (i - 72) * 20 : 0 // ~480 min/day
      ps[2] = provider('github', {
        collectedAt: at.toISOString(),
        metrics: [
          { name: 'actions_minutes', mtd: 300 + mins, unit: 'min', estCostUsd: 0 },
          { name: 'actions_paid_minutes', mtd: 300 + mins, unit: 'min', estCostUsd: 0 },
        ],
      })
      return ps
    })
    const { state } = evaluate(snaps, greenPrior(), NOW)
    ok('runaway BILLABLE GitHub Actions minutes → not GREEN', state.state !== 'GREEN', state.state)
  }

  // 7b. The same runaway on a PUBLIC repo — minutes are free and unlimited, so
  // none of them are billable. Busy CI must not trip a spend breaker.
  {
    const snaps = series(96, NOW, (i, at) => {
      const ps = normalProviders(at)
      const mins = i > 72 ? (i - 72) * 20 : 0
      ps[2] = provider('github', {
        collectedAt: at.toISOString(),
        metrics: [
          { name: 'actions_minutes', mtd: 300 + mins, unit: 'min', estCostUsd: 0 },
          { name: 'actions_paid_minutes', mtd: 0, unit: 'min', estCostUsd: 0 },
        ],
      })
      return ps
    })
    const { state } = evaluate(snaps, greenPrior(), NOW)
    ok('free (unbilled) GitHub Actions minutes never trip the breaker',
      state.state === 'GREEN',
      `${state.state}: ${state.reasons.join('; ')}`)
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

  // Regression (2026-08-07): a founder machine with no KV credentials read the
  // local file store, found no state at all, degraded to AMBER and let a
  // high-risk bulk job run for hours while production was RED — 117.6 GB/day
  // of Neon egress. A guard that can see nothing must not wave bulk work through.
  {
    rmSync(join(process.cwd(), '.costguard-state', 'costguard_state.json'), { force: true })
    let blindRefused = false
    try { await assertJobAllowed(baseSpec) }
    catch (e) { blindRefused = e instanceof JobRefusedError }
    ok('high-risk job refused when Cost Guard has no visible state', blindRefused)

    let lighterOk = true
    try { await assertJobAllowed({ operation: 'inngest:price-check', jobClass: 'deferrable', write: true }) }
    catch { lighterOk = false }
    ok('lighter job classes still run when state is unavailable', lighterOk)
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

  // ── A recovering provider must not read as a spend spike ──────────────────
  {
    // Neon fails for three days, then starts answering with a real month-to-date
    // figure. That money was already spent; it just became visible. Counting it
    // as burn produced a false RED in production on 2026-08-06.
    const snaps = series(96, NOW, (i, at) => {
      const ps = normalProviders(at)
      ps[0] = i < 90
        ? provider('neon', { collectedAt: at.toISOString(), ok: false, metrics: [], variableMtdUsd: 0 })
        : provider('neon', { collectedAt: at.toISOString(), variableMtdUsd: 7.73, metrics: [] })
      return ps
    })
    const { state } = evaluate(snaps, greenPrior(), NOW)
    ok('recovered provider does not manufacture burn',
      state.totals.burnUsdPerDay < 5,
      `burn $${state.totals.burnUsdPerDay}/day`)
    ok('recovered provider does not blow up the projection',
      state.totals.projectedMonthUsd < CFG.global.maxApprovedUsd,
      `projected $${state.totals.projectedMonthUsd}`)
    ok('recovered provider MTD is still counted in totals',
      state.totals.variableMtdUsd >= 7.73,
      `mtd $${state.totals.variableMtdUsd}`)
  }

  // ── Neon response parsing: both shapes, and no fabricated zeros ───────────
  console.log('\nNeon consumption parsing\n────────────────────────')
  {
    const legacy = {
      periods: [{
        consumption: [
          { compute_time_seconds: 3600, public_data_transfer_bytes: 1024 ** 3, private_data_transfer_bytes: 0, synthetic_storage_size_bytes: 2 * 1024 ** 3 },
          { compute_time_seconds: 1800, public_data_transfer_bytes: 1024 ** 3, private_data_transfer_bytes: 0, synthetic_storage_size_bytes: 3 * 1024 ** 3 },
        ],
      }],
    }
    const t = parseNeonConsumption(legacy)
    ok('legacy shape detected', t.shape === 'legacy', String(t.shape))
    ok('legacy compute summed', t.computeSeconds === 5400, `${t.computeSeconds}s`)
    ok('legacy transfer summed', t.publicTransferBytes === 2 * 1024 ** 3, `${t.publicTransferBytes}B`)
    ok('legacy storage takes the peak, not the sum', t.storageBytes === 3 * 1024 ** 3, `${t.storageBytes}B`)
  }
  {
    const v2 = {
      projects: [{
        periods: [{
          consumption: [
            { metrics: [
              { metric_name: 'compute_unit_seconds', value: 7200 },
              { metric_name: 'public_network_transfer_bytes', value: 5 * 1024 ** 3 },
              { metric_name: 'private_network_transfer_bytes', value: 1024 ** 3 },
              { metric_name: 'root_branch_bytes_month', value: 4 * 1024 ** 3 },
            ] },
          ],
        }],
      }],
    }
    const t = parseNeonConsumption(v2)
    ok('v2 metrics-array shape detected', t.shape === 'v2', String(t.shape))
    ok('v2 compute read from compute_unit_seconds', t.computeSeconds === 7200, `${t.computeSeconds}s`)
    ok('v2 public transfer read', t.publicTransferBytes === 5 * 1024 ** 3)
    ok('v2 storage accumulates byte-months', t.storageByteMonths === 4 * 1024 ** 3)
  }
  {
    // A 200 whose body we cannot interpret must NOT look like zero usage —
    // shape null makes collectNeon report a failure instead of a false all-clear.
    const alien = { periods: [{ consumption: [{ something_new_entirely: 42 }] }] }
    ok('unrecognised shape yields no shape', parseNeonConsumption(alien).shape === null)
    ok('unrecognised shape reports zero rows', parseNeonConsumption(alien).rows === 0)
    ok('empty body yields no shape', parseNeonConsumption({}).shape === null)
    ok('null body yields no shape', parseNeonConsumption(null).shape === null)
    ok('metrics array with only unknown names yields no shape',
      parseNeonConsumption({ periods: [{ consumption: [{ metrics: [{ metric_name: 'mystery', value: 9 }] }] }] }).shape === null)
  }

  // ── Neon granularity window ────────────────────────────────────────────────
  // Regression for the 2026-08-08 blackout: the consumption range always starts
  // at the 1st of the month, so from the 8th onward an hourly request is
  // outside Neon's 7-day hourly window and every endpoint answers 406. Cost
  // Guard lost Neon with no code change and would have done so every month.
  {
    const monthStart = new Date('2026-08-01T00:00:00Z')
    const day3  = granularityLadder(monthStart, new Date('2026-08-03T12:00:00Z'))
    const day8  = granularityLadder(monthStart, new Date('2026-08-08T02:21:00Z'))
    const day28 = granularityLadder(monthStart, new Date('2026-08-28T09:00:00Z'))

    ok('early in the month still prefers hourly', day3[0] === 'hourly')
    ok('day 8 drops hourly (the live 406 boundary)', !day8.includes('hourly'), day8.join(','))
    ok('day 8 falls back to daily first', day8[0] === 'daily', day8.join(','))
    ok('late in the month still covers the range', day28[0] === 'daily', day28.join(','))
    ok('every ladder ends with a granularity that always spans a month',
      [day3, day8, day28].every(l => l[l.length - 1] === 'monthly'))
    ok('no ladder is ever empty', [day3, day8, day28].every(l => l.length > 0))
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
