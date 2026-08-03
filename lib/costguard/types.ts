/**
 * lib/costguard/types.ts — Catch Cost Guard shared types.
 *
 * Cost Guard is the permanent multi-provider spend monitor + circuit breaker.
 * See launch/operations/COST-GUARD.md for the runbook.
 */

export type GuardState = 'GREEN' | 'AMBER' | 'RED' | 'LOCKDOWN'

export type ProviderId = 'neon' | 'vercel' | 'github' | 'cloudflare'

/** One metered dimension as reported by a provider adapter. */
export interface UsageMetric {
  /** Machine name, e.g. 'network_transfer_gb', 'compute_cu_hours' */
  name: string
  /** Month-to-date quantity in the metric's natural unit. */
  mtd: number
  unit: string
  /** Estimated variable $ cost of the MTD quantity (0 while inside included allowance). */
  estCostUsd: number
  /** Fraction of the plan's included allowance consumed, when one exists. */
  allowanceUsedPct?: number
}

/** What one provider adapter returns from a collection attempt. */
export interface ProviderUsage {
  provider: ProviderId
  /** False when the required credential env vars are absent. */
  configured: boolean
  /** True when the adapter contacted the provider and parsed a response. */
  ok: boolean
  /** Human-readable failure/attention note. Never contains secrets. */
  note?: string
  collectedAt: string          // ISO timestamp
  metrics: UsageMetric[]
  /** Fixed subscription fee for the month (never triggers breakers). */
  fixedMonthlyUsd: number
  /** Sum of metric estCostUsd — variable spend only. */
  variableMtdUsd: number
}

/** One hourly/daily collection snapshot (all providers). */
export interface Snapshot {
  at: string                   // ISO timestamp
  monthKey: string             // 'YYYY-MM'
  providers: ProviderUsage[]
  totalVariableMtdUsd: number
  totalFixedUsd: number
}

export interface GuardEvent {
  at: string
  kind:
    | 'state-change' | 'anomaly' | 'job-refused' | 'job-allowed-with-warning'
    | 'webhook' | 'collection-error' | 'lockdown-cleared' | 'alert'
  provider?: ProviderId | 'global'
  /** Dedupe key — identical keys within the dedupe window are suppressed. */
  dedupeKey?: string
  message: string
  /** Structured evidence: trigger, measured value, threshold, action taken. */
  detail?: Record<string, string | number | boolean | null>
}

export interface CostGuardState {
  state: GuardState
  since: string
  reasons: string[]
  /** Latched true by LOCKDOWN; cleared only by scripts/costguard-clear-lockdown.ts */
  lockdownLatched: boolean
  updatedAt: string
  lastCollectionAt: string | null
  /** Providers whose data is stale/missing right now. */
  staleProviders: ProviderId[]
  unconfiguredProviders: ProviderId[]
  /** MTD + projection in USD (variable spend only; fixed reported separately). */
  totals: {
    variableMtdUsd: number
    fixedMonthlyUsd: number
    projectedMonthUsd: number
    burnUsdPerDay: number
    baselineUsdPerDay: number | null
  }
  perProvider: Array<{
    provider: ProviderId
    configured: boolean
    fresh: boolean
    variableMtdUsd: number
    projectedMonthUsd: number
    budgetSoftUsd: number
    budgetMaxUsd: number
    budgetUsedPct: number
    topMetric?: string
    note?: string
  }>
  /** Operation names refused since the last GREEN, with counts. */
  activeRestrictions: Array<{ operation: string; count: number; lastAt: string }>
  /** Consecutive abnormal / clean samples for hysteresis. */
  counters: { abnormalSamples: number; cleanSamples: number }
}

/** Job classes drive what each Cost Guard state allows. */
export type JobClass =
  | 'essential'        // customer-facing reads / attribution — never gated by Cost Guard
  | 'deferrable'       // important, small, bounded — blocked only in LOCKDOWN
  | 'nonessential'     // background bulk work — blocked in RED and LOCKDOWN
  | 'high-risk'        // bulk writes / external loops — needs limits everywhere,
                       //   blocked in RED and LOCKDOWN

export interface JobSpec {
  /** Stable operation name, e.g. 'inngest:sync-retailer', 'script:backfill-covers' */
  operation: string
  jobClass: JobClass
  provider?: ProviderId | 'external-api'
  estRows?: number
  estRequests?: number
  estExternalCostUsd?: number
  maxRuntimeMs?: number
  write: boolean
  dryRun?: boolean
  checkpointId?: string
}

export class JobRefusedError extends Error {
  constructor(
    public readonly operation: string,
    public readonly guardState: GuardState,
    public readonly reason: string,
  ) {
    super(`[costguard] REFUSED ${operation} (state=${guardState}): ${reason}`)
    this.name = 'JobRefusedError'
  }
}

export class BudgetExceededError extends Error {
  constructor(public readonly operation: string, public readonly what: string) {
    super(`[costguard] BUDGET EXCEEDED in ${operation}: ${what}`)
    this.name = 'BudgetExceededError'
  }
}
