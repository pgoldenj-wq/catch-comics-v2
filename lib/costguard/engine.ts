/**
 * lib/costguard/engine.ts — pure Cost Guard evaluation. No I/O.
 *
 * evaluate(snapshots, previousState, now) → next CostGuardState.
 *
 * Guarantees:
 *  - GREEN is IMPOSSIBLE unless at least one configured provider has fresh
 *    data and nothing is abnormal. Missing/stale/unconfigured telemetry can
 *    only produce AMBER (or worse) — provider API failure can never fake calm.
 *  - Breakers act on VARIABLE spend only; fixed plan fees are reported but
 *    never trip a state.
 *  - LOCKDOWN latches. The engine never leaves LOCKDOWN by itself — only
 *    scripts/costguard-clear-lockdown.ts resets the latch.
 *  - De-escalation needs `cleanSamplesToRecover` consecutive clean samples
 *    (hysteresis: one good hour never cancels an incident).
 */

import { COSTGUARD_CONFIG as CFG } from './config'
import type {
  CostGuardState, GuardState, ProviderId, ProviderUsage, Snapshot,
} from './types'

const PROVIDERS: ProviderId[] = ['neon', 'vercel', 'github', 'cloudflare']

export interface EvalResult {
  state: CostGuardState
  /** Newly detected condition strings (for event emission by the caller). */
  newFindings: string[]
}

function daysInMonth(d: Date): number {
  return new Date(d.getUTCFullYear(), d.getUTCMonth() + 1, 0).getDate()
}

function monthKeyOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Median of an array; null when empty. */
function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Burn rate over the trailing window: (variable MTD at last snapshot −
 * variable MTD at the first snapshot ≥ windowStart) scaled to $/day.
 * Month rollovers reset MTD; a negative delta means a rollover → use the
 * latest MTD alone over the elapsed portion of the new month.
 */
function burnUsdPerDay(snaps: Snapshot[], windowMs: number, now: Date): number {
  if (snaps.length === 0) return 0
  const cutoff = now.getTime() - windowMs
  const inWindow = snaps.filter(s => Date.parse(s.at) >= cutoff)
  if (inWindow.length === 0) return 0
  const first = inWindow[0]
  const last  = inWindow[inWindow.length - 1]
  const spanMs = Math.max(Date.parse(last.at) - Date.parse(first.at), 60 * 60 * 1000)
  let delta = last.totalVariableMtdUsd - first.totalVariableMtdUsd
  if (delta < 0) delta = last.totalVariableMtdUsd // month rollover inside window
  return (delta / spanMs) * 24 * 60 * 60 * 1000
}

/** Per-provider daily rate for a named metric over the trailing window. */
function metricPerDay(
  snaps: Snapshot[], provider: ProviderId, metric: string,
  windowMs: number, now: Date,
): number {
  const cutoff = now.getTime() - windowMs
  const rows: Array<{ at: number; v: number }> = []
  for (const s of snaps) {
    const at = Date.parse(s.at)
    if (at < cutoff) continue
    const p = s.providers.find(x => x.provider === provider)
    const m = p?.metrics.find(x => x.name === metric)
    if (p?.ok && m) rows.push({ at, v: m.mtd })
  }
  if (rows.length < 2) return 0
  const spanMs = Math.max(rows[rows.length - 1].at - rows[0].at, 60 * 60 * 1000)
  let delta = rows[rows.length - 1].v - rows[0].v
  if (delta < 0) delta = rows[rows.length - 1].v
  return (delta / spanMs) * 24 * 60 * 60 * 1000
}

export function evaluate(
  snapshots: Snapshot[],
  previous: CostGuardState | null,
  now: Date = new Date(),
): EvalResult {
  const reasons: string[] = []
  const findings: string[] = []
  const latest = snapshots.length ? snapshots[snapshots.length - 1] : null

  // ── Freshness / configuration ──────────────────────────────────────────────
  const unconfigured: ProviderId[] = []
  const stale: ProviderId[] = []
  const freshOk: ProviderId[] = []
  for (const id of PROVIDERS) {
    const p = latest?.providers.find(x => x.provider === id)
    if (!p || !p.configured) { unconfigured.push(id); continue }
    const age = now.getTime() - Date.parse(p.collectedAt)
    if (!p.ok || age > CFG.freshnessMaxAgeMs) stale.push(id)
    else freshOk.push(id)
  }

  if (!latest) reasons.push('No usage snapshots collected yet — telemetry missing.')
  if (stale.length) reasons.push(`Stale/failed provider data: ${stale.join(', ')}.`)
  if (freshOk.length === 0 && latest) {
    reasons.push('No provider has fresh data — GREEN is not possible without telemetry.')
  }

  // ── Totals, burn, projection ───────────────────────────────────────────────
  const variableMtd = latest?.totalVariableMtdUsd ?? 0
  const fixedMonthly = latest?.totalFixedUsd ?? CFG.global.fixedMonthlyUsd
  const burn72h = burnUsdPerDay(snapshots, 72 * 60 * 60 * 1000, now)

  // Baseline: median of daily burns over the prior 7 days (24h buckets).
  const dailyBurns: number[] = []
  for (let d = 1; d <= 7; d++) {
    const bucketEnd = new Date(now.getTime() - (d - 1) * 86_400_000)
    const b = burnUsdPerDay(
      snapshots.filter(s => Date.parse(s.at) <= bucketEnd.getTime()),
      24 * 60 * 60 * 1000, bucketEnd,
    )
    if (b > 0) dailyBurns.push(b)
  }
  const baseline = median(dailyBurns)

  const dim = daysInMonth(now)
  const dayOfMonth = now.getUTCDate() + now.getUTCHours() / 24
  const daysLeft = Math.max(dim - dayOfMonth, 0)
  const projected = variableMtd + burn72h * daysLeft

  // ── Budget checks (variable spend only) ────────────────────────────────────
  let abnormal = false
  let severity: GuardState = 'GREEN'
  const raise = (to: GuardState, why: string) => {
    const order: GuardState[] = ['GREEN', 'AMBER', 'RED', 'LOCKDOWN']
    if (order.indexOf(to) > order.indexOf(severity)) severity = to
    reasons.push(why)
    findings.push(why)
    if (to !== 'GREEN') abnormal = true
  }

  if (variableMtd > CFG.global.catastrophicUsd) {
    raise('LOCKDOWN', `Global variable MTD $${variableMtd.toFixed(2)} exceeds catastrophic limit $${CFG.global.catastrophicUsd}.`)
  } else if (projected > CFG.global.maxApprovedUsd) {
    raise('RED', `Projected month $${projected.toFixed(2)} exceeds approved maximum $${CFG.global.maxApprovedUsd}.`)
  } else if (projected > CFG.global.softBudgetUsd) {
    raise('AMBER', `Projected month $${projected.toFixed(2)} exceeds soft budget $${CFG.global.softBudgetUsd}.`)
  }

  const perProvider: CostGuardState['perProvider'] = []
  for (const id of PROVIDERS) {
    const budget = CFG.providers[id]
    const p: ProviderUsage | undefined = latest?.providers.find(x => x.provider === id)
    const mtd = p?.ok ? p.variableMtdUsd : 0
    const provBurn = metricAgnosticProviderBurn(snapshots, id, now)
    const provProjected = mtd + provBurn * daysLeft
    if (p?.ok) {
      if (mtd > budget.catastrophicUsd) {
        raise('LOCKDOWN', `${id}: variable MTD $${mtd.toFixed(2)} exceeds catastrophic $${budget.catastrophicUsd}.`)
      } else if (provProjected > budget.maxApprovedUsd) {
        raise('RED', `${id}: projected $${provProjected.toFixed(2)} exceeds max approved $${budget.maxApprovedUsd}.`)
      } else if (provProjected > budget.softBudgetUsd) {
        raise('AMBER', `${id}: projected $${provProjected.toFixed(2)} exceeds soft budget $${budget.softBudgetUsd}.`)
      }
    }
    perProvider.push({
      provider: id,
      configured: p?.configured ?? false,
      fresh: freshOk.includes(id),
      variableMtdUsd: Number(mtd.toFixed(2)),
      projectedMonthUsd: Number(provProjected.toFixed(2)),
      budgetSoftUsd: budget.softBudgetUsd,
      budgetMaxUsd: budget.maxApprovedUsd,
      budgetUsedPct: budget.maxApprovedUsd > 0
        ? Number(((mtd / budget.maxApprovedUsd) * 100).toFixed(1)) : 0,
      topMetric: p?.metrics?.slice().sort((a, b) => b.estCostUsd - a.estCostUsd)[0]?.name,
      note: p?.note,
    })
  }

  // ── Metric-rate checks (measured units, not estimates) ─────────────────────
  const neonTransfer = metricPerDay(snapshots, 'neon', 'network_transfer_gb', 24 * 3_600_000, now)
  if (neonTransfer > CFG.rates.neonTransferGbPerDay.red) {
    raise('RED', `Neon transfer ${neonTransfer.toFixed(1)} GB/day exceeds RED threshold ${CFG.rates.neonTransferGbPerDay.red} GB/day.`)
  } else if (neonTransfer > CFG.rates.neonTransferGbPerDay.amber) {
    raise('AMBER', `Neon transfer ${neonTransfer.toFixed(1)} GB/day exceeds AMBER threshold ${CFG.rates.neonTransferGbPerDay.amber} GB/day.`)
  }
  const neonCompute = metricPerDay(snapshots, 'neon', 'compute_cu_hours', 24 * 3_600_000, now)
  if (neonCompute > CFG.rates.neonComputeCuPerDay.red) {
    raise('RED', `Neon compute ${neonCompute.toFixed(1)} CU-hr/day exceeds RED threshold ${CFG.rates.neonComputeCuPerDay.red}.`)
  } else if (neonCompute > CFG.rates.neonComputeCuPerDay.amber) {
    raise('AMBER', `Neon compute ${neonCompute.toFixed(1)} CU-hr/day exceeds AMBER threshold ${CFG.rates.neonComputeCuPerDay.amber}.`)
  }

  const ghMinutes = metricPerDay(snapshots, 'github', 'actions_minutes', 24 * 3_600_000, now)
  if (ghMinutes > CFG.rates.githubMinutesPerDay.red) {
    raise('RED', `GitHub Actions ${ghMinutes.toFixed(0)} min/day exceeds RED threshold ${CFG.rates.githubMinutesPerDay.red}.`)
  } else if (ghMinutes > CFG.rates.githubMinutesPerDay.amber) {
    raise('AMBER', `GitHub Actions ${ghMinutes.toFixed(0)} min/day exceeds AMBER threshold ${CFG.rates.githubMinutesPerDay.amber}.`)
  }

  const r2ClassA = metricPerDay(snapshots, 'cloudflare', 'r2_class_a_ops', 24 * 3_600_000, now)
  if (r2ClassA > CFG.rates.r2ClassAOpsPerDay.red) {
    raise('RED', `R2 Class A ${Math.round(r2ClassA).toLocaleString()} ops/day exceeds RED threshold ${CFG.rates.r2ClassAOpsPerDay.red.toLocaleString()}.`)
  } else if (r2ClassA > CFG.rates.r2ClassAOpsPerDay.amber) {
    raise('AMBER', `R2 Class A ${Math.round(r2ClassA).toLocaleString()} ops/day exceeds AMBER threshold ${CFG.rates.r2ClassAOpsPerDay.amber.toLocaleString()}.`)
  }

  // ── Anomaly vs baseline ────────────────────────────────────────────────────
  if (baseline !== null && baseline > 0.10 && burn72h > baseline * CFG.anomalyMultiplier) {
    raise('AMBER', `Burn $${burn72h.toFixed(2)}/day is ${(burn72h / baseline).toFixed(1)}× the 7-day baseline $${baseline.toFixed(2)}/day.`)
  }

  // ── Telemetry gaps force AMBER (never silently GREEN) ──────────────────────
  if (severity === 'GREEN' && (freshOk.length === 0 || stale.length > 0)) {
    severity = 'AMBER'
    abnormal = false // telemetry gap is not a spend anomaly — no RED escalation
  }

  // ── Hysteresis + latching ──────────────────────────────────────────────────
  let abnormalSamples = previous?.counters.abnormalSamples ?? 0
  let cleanSamples = previous?.counters.cleanSamples ?? 0
  if (abnormal) { abnormalSamples += 1; cleanSamples = 0 }
  else { cleanSamples += 1; abnormalSamples = 0 }

  // Repeated AMBER spend-anomalies escalate to RED.
  if (severity === 'AMBER' && abnormal && abnormalSamples >= CFG.abnormalSamplesForRed) {
    severity = 'RED'
    const msg = `AMBER condition persisted for ${abnormalSamples} consecutive samples — escalating to RED.`
    reasons.push(msg); findings.push(msg)
  }

  // Read through a function: raise() mutates `severity` inside a closure,
  // which TS control-flow narrowing cannot see at this comparison site.
  const currentSeverity = (): GuardState => severity
  const lockdownLatched = (previous?.lockdownLatched ?? false) || currentSeverity() === 'LOCKDOWN'
  if (lockdownLatched) severity = 'LOCKDOWN'

  // De-escalation from a previously worse state requires clean streak.
  const order: GuardState[] = ['GREEN', 'AMBER', 'RED', 'LOCKDOWN']
  const prevState = previous?.state ?? 'AMBER'
  if (!lockdownLatched && order.indexOf(severity) < order.indexOf(prevState)) {
    if (cleanSamples < CFG.cleanSamplesToRecover) {
      severity = prevState === 'LOCKDOWN' ? 'RED' : prevState
      reasons.push(`Holding ${severity} until ${CFG.cleanSamplesToRecover} clean samples (currently ${cleanSamples}).`)
    } else {
      // Step down one level per recovery streak, never jump LOCKDOWN→GREEN.
      severity = order[Math.max(order.indexOf(prevState) - 1, order.indexOf(severity))]
      cleanSamples = 0
      findings.push(`Recovered one level to ${severity} after clean streak.`)
    }
  }

  if (unconfigured.length) {
    reasons.push(`Not yet configured (no credentials): ${unconfigured.join(', ')}.`)
  }

  const stateChanged = previous?.state !== severity
  const next: CostGuardState = {
    state: severity,
    since: stateChanged || !previous ? now.toISOString() : previous.since,
    reasons,
    lockdownLatched,
    updatedAt: now.toISOString(),
    lastCollectionAt: latest?.at ?? null,
    staleProviders: stale,
    unconfiguredProviders: unconfigured,
    totals: {
      variableMtdUsd: Number(variableMtd.toFixed(2)),
      fixedMonthlyUsd: Number(fixedMonthly.toFixed(2)),
      projectedMonthUsd: Number(projected.toFixed(2)),
      burnUsdPerDay: Number(burn72h.toFixed(2)),
      baselineUsdPerDay: baseline === null ? null : Number(baseline.toFixed(2)),
    },
    perProvider,
    activeRestrictions: severity === 'GREEN' ? [] : (previous?.activeRestrictions ?? []),
    counters: { abnormalSamples, cleanSamples },
  }
  if (stateChanged) findings.push(`State changed ${previous?.state ?? '(none)'} → ${severity}.`)
  return { state: next, newFindings: findings }
}

/** Provider variable-$ burn per day over trailing 72h. */
function metricAgnosticProviderBurn(snaps: Snapshot[], id: ProviderId, now: Date): number {
  const cutoff = now.getTime() - 72 * 3_600_000
  const rows: Array<{ at: number; v: number }> = []
  for (const s of snaps) {
    const at = Date.parse(s.at)
    if (at < cutoff) continue
    const p = s.providers.find(x => x.provider === id)
    if (p?.ok) rows.push({ at, v: p.variableMtdUsd })
  }
  if (rows.length < 2) return 0
  const spanMs = Math.max(rows[rows.length - 1].at - rows[0].at, 3_600_000)
  let delta = rows[rows.length - 1].v - rows[0].v
  if (delta < 0) delta = rows[rows.length - 1].v
  return (delta / spanMs) * 86_400_000
}

export { monthKeyOf }
