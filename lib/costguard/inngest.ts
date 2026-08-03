/**
 * lib/costguard/inngest.ts — Cost Guard gate adapter for Inngest functions.
 *
 * Inngest retries thrown errors, so a refusal must NOT throw — it returns a
 * plain, serializable verdict the function can act on inside a memoized
 * step. A refused run ends as a clean skip; the audit trail lives in the
 * Cost Guard event store ('job-refused' events), not in Inngest failures.
 *
 * Usage at the top of a function body:
 *
 *   const gate = await step.run('costguard-gate', () =>
 *     inngestCostGate({ operation: 'inngest:sync-retailer', jobClass: 'nonessential',
 *                       estRows: 20_000, estRequests: 500, maxRuntimeMs: 15 * 60_000,
 *                       write: true }))
 *   if (!gate.allowed) {
 *     console.warn(`[costguard] skipping: ${gate.reason}`)
 *     return { skipped: 'costguard', reason: gate.reason }
 *   }
 */

import { assertJobAllowed } from './gate'
import { JobRefusedError, type JobSpec } from './types'

export interface InngestGateVerdict {
  allowed: boolean
  reason: string
}

export async function inngestCostGate(spec: JobSpec): Promise<InngestGateVerdict> {
  try {
    await assertJobAllowed(spec)
    return { allowed: true, reason: 'ok' }
  } catch (err) {
    if (err instanceof JobRefusedError) {
      return { allowed: false, reason: err.message }
    }
    // Store outage or unexpected error: fail SAFE for bulk work — treat as
    // refused rather than letting an error masquerade as permission.
    return {
      allowed: false,
      reason: `costguard gate errored (${(err as Error).message}) — refusing bulk work as the safe default`,
    }
  }
}
