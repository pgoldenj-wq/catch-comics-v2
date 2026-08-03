/**
 * lib/costguard/collect.ts — the usage snapshot collector.
 *
 * Runs all provider adapters, appends a snapshot, evaluates the state
 * machine, persists the new state, and emits deduplicated events for any
 * new findings. Called by:
 *   - POST /api/costguard/collect (hourly GitHub Actions cron)
 *   - npm run costguard:collect   (manual / founder machine)
 *
 * Server-side only.
 */

import { COSTGUARD_CONFIG as CFG } from './config'
import { evaluate, monthKeyOf } from './engine'
import {
  appendEvent, appendSnapshot, getSnapshots, getState, getVercelWebhookMemo,
  setState, storeMode,
} from './store'
import { collectCloudflare } from './providers/cloudflare'
import { collectGithub } from './providers/github'
import { collectNeon } from './providers/neon'
import { collectVercel } from './providers/vercel'
import type { CostGuardState, Snapshot } from './types'

export interface CollectResult {
  state: CostGuardState
  snapshot: Snapshot
  storeMode: 'kv' | 'file'
  emittedEvents: number
}

export async function runCollection(now: Date = new Date()): Promise<CollectResult> {
  const webhookMemo = await getVercelWebhookMemo()
  const [neon, vercel, github, cloudflare] = await Promise.all([
    collectNeon(now),
    collectVercel(webhookMemo, now),
    collectGithub(now),
    collectCloudflare(now),
  ])

  const providers = [neon, vercel, github, cloudflare]
  const snapshot: Snapshot = {
    at: now.toISOString(),
    monthKey: monthKeyOf(now),
    providers,
    totalVariableMtdUsd: Number(
      providers.reduce((s, p) => s + (p.ok ? p.variableMtdUsd : 0), 0).toFixed(2),
    ),
    totalFixedUsd: Number(
      providers.reduce((s, p) => s + p.fixedMonthlyUsd, 0).toFixed(2),
    ),
  }
  await appendSnapshot(snapshot)

  const snapshots = await getSnapshots(snapshot.monthKey)
  const previous = await getState()
  const { state, newFindings } = evaluate(snapshots, previous, now)
  await setState(state)

  let emitted = 0
  for (const finding of newFindings) {
    const ok = await appendEvent(
      {
        at: now.toISOString(),
        kind: finding.startsWith('State changed') ? 'state-change' : 'anomaly',
        provider: 'global',
        dedupeKey: `finding:${finding.replace(/[\d.$]+/g, '#')}`, // numbers vary — dedupe on shape
        message: finding,
        detail: {
          variableMtdUsd: state.totals.variableMtdUsd,
          projectedMonthUsd: state.totals.projectedMonthUsd,
          burnUsdPerDay: state.totals.burnUsdPerDay,
          state: state.state,
        },
      },
      CFG.alertDedupeWindowMs,
    )
    if (ok) emitted += 1
  }

  // Collection problems are themselves events (visible, deduped).
  for (const p of providers) {
    if (p.configured && !p.ok) {
      await appendEvent(
        {
          at: now.toISOString(),
          kind: 'collection-error',
          provider: p.provider,
          dedupeKey: `collect-error:${p.provider}`,
          message: `${p.provider} collection failed: ${p.note ?? 'unknown error'}`,
        },
        CFG.alertDedupeWindowMs,
      )
    }
  }

  return { state, snapshot, storeMode: storeMode(), emittedEvents: emitted }
}
