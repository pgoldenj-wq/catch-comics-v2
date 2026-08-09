/**
 * Per-run ceiling on child events emitted by one sync.
 *
 * Why this exists (2026-08-09 Inngest quota incident): every canonical product
 * created inside a sync fires one `bookshop/lookup` event, and each of those is
 * a whole Inngest function run. A retailer feed that times out mid-ingest still
 * creates products, gets retried, and creates more — 55,177 products in 30 days
 * became ~55,000 executions and consumed ~68% of the monthly Hobby allowance.
 *
 * The parent is the only place that can see "this one run has emitted far more
 * children than any healthy run ever does". Gating each individual product
 * through Cost Guard would mean a KV round-trip per product — the very cost
 * shape we are trying to avoid — so the budget is held in memory for the
 * lifetime of a single sync run and simply stops emitting past the ceiling.
 *
 * Suppression is truthful, not silent: the count is reported back through
 * SyncResult.errors, so it lands in `sync_logs.error_summary` and the job
 * shows as errored rather than quietly succeeding with missing work.
 *
 * AsyncLocalStorage (not a module-level counter) because `sync-retailer` runs
 * with `concurrency: { limit: 5 }` — up to five syncs can share one warm
 * lambda, and they must not spend each other's budget.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Ceiling per sync run. A healthy incremental sync creates a handful of new
 * products; the biggest legitimate day observed on travellingman.com was 26.
 * 500 leaves ~20x headroom for a genuine catalogue expansion while capping a
 * runaway at 1% of the monthly allowance instead of 100%.
 */
export const DEFAULT_FANOUT_CEILING = Number(
  process.env.SYNC_FANOUT_CEILING ?? 500,
)

export interface FanoutBudget {
  ceiling: number
  /** Child events actually emitted. */
  emitted: number
  /** Child events refused because the ceiling was reached. */
  suppressed: number
}

const store = new AsyncLocalStorage<FanoutBudget>()

/**
 * Run `fn` with a fresh child-event budget. Returns the work's result plus the
 * budget so the caller can report suppression honestly.
 *
 * Outside a `withFanoutBudget` scope (CLI scripts, tests, the admin one-off
 * path) there is no budget and emission is unrestricted — those paths are
 * human-initiated and already gated elsewhere.
 */
export async function withFanoutBudget<T>(
  fn: () => Promise<T>,
  ceiling: number = DEFAULT_FANOUT_CEILING,
): Promise<{ result: T; budget: FanoutBudget }> {
  const budget: FanoutBudget = { ceiling, emitted: 0, suppressed: 0 }
  const result = await store.run(budget, fn)
  return { result, budget }
}

/** The budget for the current run, or undefined when running unscoped. */
export function currentFanoutBudget(): FanoutBudget | undefined {
  return store.getStore()
}

/**
 * Claim one child-event slot.
 *
 * Returns false once the ceiling is reached — the caller must not emit. The
 * first refusal logs once; further refusals only increment the counter, so a
 * runaway cannot also become a log flood.
 */
export function claimFanoutSlot(label: string): boolean {
  const budget = store.getStore()
  if (!budget) return true

  if (budget.emitted >= budget.ceiling) {
    budget.suppressed += 1
    if (budget.suppressed === 1) {
      console.error(
        `[fanout] ceiling reached: ${budget.emitted} ${label} events emitted in this run. ` +
        `Further child events are suppressed. This run is ingesting far more new ` +
        `products than a healthy incremental sync — check the feed before raising ` +
        `SYNC_FANOUT_CEILING.`,
      )
    }
    return false
  }

  budget.emitted += 1
  return true
}

/**
 * Human-readable suppression notice for SyncResult.errors, or null when the run
 * stayed inside its budget.
 */
export function fanoutSuppressionNotice(budget: FanoutBudget): string | null {
  if (budget.suppressed === 0) return null
  return (
    `child-event ceiling reached: emitted ${budget.emitted}, ` +
    `suppressed ${budget.suppressed} bookshop/lookup event(s) ` +
    `(ceiling ${budget.ceiling} per run)`
  )
}
