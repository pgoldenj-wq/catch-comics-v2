/**
 * retailer-refresh-state.mjs — the one place that decides what the Retailer
 * Price Refresh card says.
 *
 * Pure and dependency-free on purpose: mission-control.html imports it at
 * runtime and scripts/test-retailer-refresh-card.mjs imports the same file, so
 * the states the tests prove are literally the states the founder sees.
 *
 * It contains NO retailer logic. It does not verify prices, choose cohorts,
 * decide identity or compute ceilings — scripts/price-verify-dryrun.ts is the
 * authority for all of that and writes the two files this reads:
 *
 *   price-verify-write-latest.json   last SUCCESSFUL run (never written by a
 *                                    blocked/partial attempt, which is what
 *                                    stops a failure moving the deadline)
 *   price-verify-status.json         latest attempt + live progress
 *
 * This module only turns those into a status word, a countdown and a label.
 */

/** Reminder thresholds, in days remaining before the refreshed rows expire. */
export const DUE_SOON_DAYS = 7
export const URGENT_DAYS   = 2

/**
 * A run writes progress at least every 25 rows (~30s). If the status file says
 * "running" but has not been touched for this long, the process died without
 * getting to write a result — a reboot, a closed laptop, a kill. Reporting
 * that as RUNNING forever would be a lie that also hides the real deadline.
 */
export const STALE_RUNNING_MS = 15 * 60_000

/**
 * @param {object|null} success  parsed price-verify-write-latest.json
 * @param {object|null} status   parsed price-verify-status.json
 * @param {number} now           epoch ms (injected so tests are deterministic)
 */
export function deriveRetailerState(success, status, now = Date.now()) {
  const runState = status?.state ?? null

  const lastBeat = status?.updatedAt ? new Date(status.updatedAt).getTime() : null
  const stalled = runState === 'running' && lastBeat !== null && (now - lastBeat) > STALE_RUNNING_MS

  if (stalled) {
    return {
      status: 'INTERRUPTED',
      severity: 'warn',
      headline: 'A refresh stopped without finishing — no deadline was moved. Safe to run again.',
      needsAction: true,
      inFlight: false,
      daysLeft: daysLeftFrom(success, now),
      attemptAt: status?.updatedAt ?? null,
      rowsWrittenInAttempt: status?.rowsWritten ?? 0,
    }
  }

  // Live states win over any date arithmetic: what the operation is doing now
  // matters more than when it is next due.
  if (runState === 'running') {
    const p = status ?? {}
    return {
      status: 'RUNNING',
      severity: 'running',
      headline: buildProgressLine(p),
      needsAction: false,
      inFlight: true,
      daysLeft: daysLeftFrom(success, now),
    }
  }

  const daysLeft = daysLeftFrom(success, now)

  // A blocked or failed attempt is shown as its own thing, alongside — never
  // instead of — the last successful refresh, and it never moves the deadline.
  if (runState === 'blocked' || runState === 'failed') {
    return {
      status: runState === 'blocked' ? 'BLOCKED · SAFE STOP' : 'FAILED',
      severity: runState === 'blocked' ? 'blocked' : 'fail',
      headline: status?.reason
        ? `${runState === 'blocked' ? 'SAFE STOP' : 'Failed'} — ${status.reason}`
        : `Last attempt ${runState}`,
      needsAction: true,
      inFlight: false,
      daysLeft,
      attemptAt: status?.finishedAt ?? status?.updatedAt ?? null,
      rowsWrittenInAttempt: status?.rowsWritten ?? 0,
    }
  }

  if (!success || daysLeft === null) {
    return {
      status: 'NEVER RUN',
      severity: 'notrun',
      headline: 'No verified retailer refresh on record',
      needsAction: true,
      inFlight: false,
      daysLeft: null,
    }
  }

  if (daysLeft <= 0) {
    return {
      status: 'OVERDUE', severity: 'fail', needsAction: true, inFlight: false, daysLeft,
      headline: `Retailer prices need refreshing — expired ${Math.abs(daysLeft)} ${plural(Math.abs(daysLeft), 'day')} ago`,
    }
  }
  if (daysLeft <= URGENT_DAYS) {
    return {
      status: 'URGENT', severity: 'fail', needsAction: true, inFlight: false, daysLeft,
      headline: `Retailer prices need refreshing — ${daysLeft} ${plural(daysLeft, 'day')} left`,
    }
  }
  if (daysLeft <= DUE_SOON_DAYS) {
    return {
      status: 'DUE SOON', severity: 'warn', needsAction: true, inFlight: false, daysLeft,
      headline: `Retailer refresh due soon — ${daysLeft} ${plural(daysLeft, 'day')} remaining`,
    }
  }
  return {
    status: 'HEALTHY', severity: 'pass', needsAction: false, inFlight: false, daysLeft,
    headline: `Retailer prices healthy — ${daysLeft} ${plural(daysLeft, 'day')} remaining`,
  }
}

/**
 * Whole days until the refreshed cohort expires, from the deadline the
 * operational script computed. Returns null when nothing has ever succeeded.
 */
export function daysLeftFrom(success, now = Date.now()) {
  const iso = success?.freshness?.nextExpiryAt
  if (!iso) return null
  const ms = new Date(iso).getTime()
  if (Number.isNaN(ms)) return null
  return Math.ceil((ms - now) / 86_400_000)
}

/** "Travelling Man · 742 / 2,291 verified" — only real counters, never estimates. */
export function buildProgressLine(p) {
  if (!p || p.phase === 'starting') return 'Starting…'
  if (p.phase === 'enumerating catalogue') return 'Enumerating Travelling Man catalogue from sitemaps…'
  const target = p.measuredTarget ?? null
  const checked = p.rowsChecked ?? 0
  const who = p.retailer ? `${p.retailer} · ` : ''
  if (target === null) return `${who}${checked.toLocaleString()} rows checked`
  return `${who}${checked.toLocaleString()} / ${target.toLocaleString()} verified`
}

/** Total rows in the last measured cohort, or null if never measured. */
export function measuredTarget(success, status) {
  if (status?.measuredTarget != null) return status.measuredTarget
  if (success) {
    const tm = success.travellingMan?.targetRows ?? 0
    const wob = success.worldOfBooks?.targetRows ?? 0
    if (tm + wob > 0) return tm + wob
  }
  return null
}

function plural(n, word) { return n === 1 ? word : `${word}s` }
