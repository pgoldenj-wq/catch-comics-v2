/**
 * lib/costguard/gate.ts — the ONE reusable Cost Guard gate for scheduled and
 * bulk processes, plus the JobBudget runtime limiter.
 *
 * Usage (at the very top of a job, before ANY work):
 *
 *   const budget = await assertJobAllowed({
 *     operation: 'script:backfill-covers',
 *     jobClass:  'high-risk',
 *     provider:  'cloudflare',
 *     estRows:   5000,
 *     write:     true,
 *     maxRuntimeMs: 2 * 60 * 60 * 1000,
 *   })
 *   ...
 *   for (const row of rows) { budget.countRow(); ... }   // throws when exceeded
 *
 * Policy matrix (see COST-GUARD.md):
 *   GREEN    → everything runs within its own limits.
 *   AMBER    → nonessential/high-risk run ONLY with explicit limits declared;
 *              new unbounded bulk work is refused.
 *   RED      → nonessential + high-risk REFUSED. deferrable runs. essential runs.
 *   LOCKDOWN → only essential runs. Everything else refused.
 *
 * Unreachable/absent state is treated as AMBER (never as GREEN), so a store
 * outage cannot silently unshackle bulk jobs — but also cannot take down
 * bounded, limit-declaring work or the public site.
 *
 * A refusal throws JobRefusedError BEFORE any work happens and records a
 * 'job-refused' event with trigger, measured value, threshold and action.
 */

import { COSTGUARD_CONFIG as CFG } from './config'
import { appendEvent, getState, setState } from './store'
import {
  BudgetExceededError, JobRefusedError,
  type CostGuardState, type GuardState, type JobSpec,
} from './types'

const STATE_ORDER: GuardState[] = ['GREEN', 'AMBER', 'RED', 'LOCKDOWN']

function hasExplicitLimits(spec: JobSpec): boolean {
  return Boolean(
    (spec.estRows !== undefined || spec.estRequests !== undefined) &&
    spec.maxRuntimeMs !== undefined,
  )
}

async function recordRefusal(
  spec: JobSpec, state: CostGuardState | null, guardState: GuardState, reason: string,
): Promise<void> {
  await appendEvent(
    {
      at: new Date().toISOString(),
      kind: 'job-refused',
      provider: spec.provider === 'external-api' ? 'global' : (spec.provider ?? 'global'),
      dedupeKey: `refused:${spec.operation}:${guardState}`,
      message: `Refused ${spec.operation}: ${reason}`,
      detail: {
        trigger: reason,
        operation: spec.operation,
        jobClass: spec.jobClass,
        guardState,
        write: spec.write,
        estRows: spec.estRows ?? null,
        estRequests: spec.estRequests ?? null,
        projectedMonthUsd: state?.totals.projectedMonthUsd ?? null,
        thresholdMaxApprovedUsd: CFG.global.maxApprovedUsd,
        action: 'job refused before any work ran',
      },
    },
    CFG.alertDedupeWindowMs,
  )
  // Track on the state doc so Mission Control can show active restrictions.
  if (state) {
    const found = state.activeRestrictions.find(r => r.operation === spec.operation)
    if (found) { found.count += 1; found.lastAt = new Date().toISOString() }
    else state.activeRestrictions.push({ operation: spec.operation, count: 1, lastAt: new Date().toISOString() })
    await setState(state)
  }
}

/**
 * The gate. Resolves to a JobBudget on success; throws JobRefusedError on
 * refusal. NEVER call this from customer-facing request paths — essential
 * reads are essential precisely because they skip the gate.
 */
export async function assertJobAllowed(spec: JobSpec): Promise<JobBudget> {
  const state = await getState()
  // No state = telemetry has never run or the store is unreachable → AMBER.
  const guardState: GuardState = state?.state ?? 'AMBER'
  const stale = state
    ? Date.now() - Date.parse(state.updatedAt) > CFG.freshnessMaxAgeMs
    : true
  const effective: GuardState =
    stale && STATE_ORDER.indexOf(guardState) < STATE_ORDER.indexOf('AMBER')
      ? 'AMBER' : guardState

  // Dry runs never spend meaningfully — allow everywhere except LOCKDOWN.
  const isDry = spec.dryRun === true

  // Read-only dry runs stay available in LOCKDOWN — diagnosing an incident
  // must not require lifting it. Anything that writes is refused below.
  const readOnlyDry = isDry && !spec.write
  if (effective === 'LOCKDOWN' && spec.jobClass !== 'essential' && !readOnlyDry) {
    const reason = 'Cost Guard is in LOCKDOWN — only essential operations may run. Clear with npm run costguard:clear.'
    await recordRefusal(spec, state, effective, reason)
    throw new JobRefusedError(spec.operation, effective, reason)
  }

  // A guard that cannot see any state is not a guard. On 2026-08-07 a founder
  // machine with no KV credentials read the local file store, found no state,
  // degraded to AMBER, and let a high-risk bulk job run for hours while
  // production was RED — 117.6 GB/day of Neon egress. AMBER is a fine default
  // for lighter classes, but high-risk work must not proceed blind.
  if (state === null && !isDry && spec.jobClass === 'high-risk') {
    const reason =
      'Cost Guard has no visible state — refusing a high-risk job rather than running blind. ' +
      'Set KV_REST_API_URL + KV_REST_API_TOKEN so this machine reads the shared state, ' +
      'or run `npm run costguard:collect` first.'
    await recordRefusal(spec, state, effective, reason)
    throw new JobRefusedError(spec.operation, effective, reason)
  }

  if (effective === 'RED' && !isDry &&
      (spec.jobClass === 'nonessential' || spec.jobClass === 'high-risk')) {
    const reason = `Cost Guard is RED (${state?.reasons[0] ?? 'no telemetry'}) — nonessential and high-risk jobs are blocked.`
    await recordRefusal(spec, state, effective, reason)
    throw new JobRefusedError(spec.operation, effective, reason)
  }

  if (effective === 'AMBER' && !isDry &&
      (spec.jobClass === 'nonessential' || spec.jobClass === 'high-risk') &&
      !hasExplicitLimits(spec)) {
    const reason = 'Cost Guard is AMBER — bulk jobs must declare explicit estRows/estRequests AND maxRuntimeMs to run.'
    await recordRefusal(spec, state, effective, reason)
    throw new JobRefusedError(spec.operation, effective, reason)
  }

  // High-risk jobs must always carry limits, in every state.
  if (spec.jobClass === 'high-risk' && !isDry && !hasExplicitLimits(spec)) {
    const reason = 'High-risk jobs must declare explicit size limits (estRows/estRequests + maxRuntimeMs) in every state.'
    await recordRefusal(spec, state, effective, reason)
    throw new JobRefusedError(spec.operation, effective, reason)
  }

  // Oversize single operations are refused up front.
  const maxRows = CFG.defaultLimits.maxRows
  if ((spec.estRows ?? 0) > maxRows) {
    const reason = `Declared estRows ${spec.estRows} exceeds the ceiling ${maxRows} — split the job or raise the ceiling in config.ts deliberately.`
    await recordRefusal(spec, state, effective, reason)
    throw new JobRefusedError(spec.operation, effective, reason)
  }

  if (effective !== 'GREEN') {
    await appendEvent(
      {
        at: new Date().toISOString(),
        kind: 'job-allowed-with-warning',
        dedupeKey: `allowed-warn:${spec.operation}:${effective}`,
        message: `${spec.operation} allowed in ${effective} (class=${spec.jobClass}${isDry ? ', dry-run' : ''}).`,
      },
      CFG.alertDedupeWindowMs,
    )
  }

  return new JobBudget(spec)
}

/**
 * Runtime limiter: count rows/requests and check elapsed time as the job
 * progresses. Throws BudgetExceededError the moment a ceiling is crossed so
 * loops abort deterministically instead of running away.
 */
export class JobBudget {
  private rows = 0
  private requests = 0
  private readonly startedAt = Date.now()
  private readonly maxRows: number
  private readonly maxRequests: number
  private readonly maxRuntimeMs: number

  constructor(private readonly spec: JobSpec) {
    this.maxRows = spec.estRows ?? CFG.defaultLimits.maxRows
    this.maxRequests = spec.estRequests ?? CFG.defaultLimits.maxRequests
    this.maxRuntimeMs = spec.maxRuntimeMs ?? CFG.defaultLimits.maxRuntimeMs
  }

  countRow(n = 1): void {
    this.rows += n
    if (this.rows > this.maxRows) {
      throw new BudgetExceededError(this.spec.operation, `rows ${this.rows} > limit ${this.maxRows}`)
    }
    this.checkRuntime()
  }

  countRequest(n = 1): void {
    this.requests += n
    if (this.requests > this.maxRequests) {
      throw new BudgetExceededError(this.spec.operation, `requests ${this.requests} > limit ${this.maxRequests}`)
    }
    this.checkRuntime()
  }

  checkRuntime(): void {
    const elapsed = Date.now() - this.startedAt
    if (elapsed > this.maxRuntimeMs) {
      throw new BudgetExceededError(
        this.spec.operation,
        `runtime ${(elapsed / 60000).toFixed(1)}min > limit ${(this.maxRuntimeMs / 60000).toFixed(0)}min`,
      )
    }
  }

  get counts(): { rows: number; requests: number; elapsedMs: number } {
    return { rows: this.rows, requests: this.requests, elapsedMs: Date.now() - this.startedAt }
  }
}

/**
 * Retry helper with a hard cap and exponential backoff — prevents
 * uncontrolled retry storms against providers or the database.
 */
export async function withCappedRetries<T>(
  operation: string,
  fn: () => Promise<T>,
  { maxAttempts = 3, baseDelayMs = 1000 }: { maxAttempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { return await fn() } catch (err) {
      lastErr = err
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, baseDelayMs * 2 ** (attempt - 1)))
      }
    }
  }
  throw new Error(`[costguard] ${operation}: failed after ${maxAttempts} capped attempts: ${(lastErr as Error)?.message}`)
}
