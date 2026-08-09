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
import type { CostGuardState, ProviderId, Snapshot } from './types'

export interface CollectResult {
  state: CostGuardState
  snapshot: Snapshot
  storeMode: 'kv' | 'file'
  emittedEvents: number
  /** Providers blind for more than STALE_ESCALATION_SAMPLES collections running. */
  persistentStaleProviders: ProviderId[]
  /** Newly-emitted persistent-stale alerts — 0 means "already reported". */
  staleEscalations: number
  /** Providers that were persistently stale and answered again this cycle. */
  recoveredProviders: ProviderId[]
}

/**
 * A provider blind for this many consecutive collections stops being a passing
 * warning and becomes a failure. Six hourly samples ≈ 6h, matching the recovery
 * hysteresis: long enough that a transient provider blip stays quiet, short
 * enough that a real blackout cannot hide for a day.
 *
 * This exists because of 2026-08-08: Neon returned nothing for 33 hours while
 * every run showed a green tick, because a single stale provider only ever
 * produced AMBER and AMBER exits 0.
 */
const STALE_ESCALATION_SAMPLES = 6

/**
 * How many collections in a row, counting back from the end, this configured
 * provider failed to return usable telemetry. Derived from the snapshots we
 * already store, so no new state is persisted for it.
 */
export function consecutiveFailures(
  snapshots: Snapshot[], provider: ProviderId, ignoreLast = 0,
): number {
  const list = ignoreLast ? snapshots.slice(0, -ignoreLast) : snapshots
  let n = 0
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i].providers.find(x => x.provider === provider)
    if (!p || !p.configured) break        // unconfigured is a different problem
    if (p.ok) break
    n += 1
  }
  return n
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

  // ── Persistent blind spots ────────────────────────────────────────────────
  // A single stale provider only ever yields AMBER, and AMBER exits 0, so a
  // provider can stop reporting indefinitely behind a wall of green ticks.
  // Once a provider has been blind for STALE_ESCALATION_SAMPLES collections
  // running it escalates to a failure — but only ONCE per dedupe window, so a
  // long blackout costs one email plus a 6-hourly reminder, not one an hour.
  const persistentStaleProviders: ProviderId[] = []
  const recoveredProviders: ProviderId[] = []
  let staleEscalations = 0

  for (const p of providers) {
    if (!p.configured) continue
    const streak = consecutiveFailures(snapshots, p.provider)

    if (!p.ok && streak >= STALE_ESCALATION_SAMPLES) {
      persistentStaleProviders.push(p.provider)
      const fresh = await appendEvent(
        {
          at: now.toISOString(),
          kind: 'alert',
          provider: p.provider,
          // Numberless key: the streak grows every hour, and keying on it would
          // defeat the dedupe and reproduce the original email storm.
          dedupeKey: `stale-persistent:${p.provider}`,
          message: `${p.provider} has returned no usable telemetry for ${streak} consecutive collections — its spend is unmonitored and reads as $0.`,
          detail: { provider: p.provider, consecutiveFailures: streak, note: p.note ?? null },
        },
        CFG.alertDedupeWindowMs,
      )
      if (fresh) { staleEscalations += 1; emitted += 1 }
    }

    // Recovery is reported exactly once, and only for a blackout that was
    // actually escalated — a one-sample blip never earned an email, so it must
    // not earn a recovery one either. A unique key means it is never suppressed.
    if (p.ok) {
      const priorStreak = consecutiveFailures(snapshots, p.provider, 1)
      if (priorStreak >= STALE_ESCALATION_SAMPLES) {
        recoveredProviders.push(p.provider)
        await appendEvent(
          {
            at: now.toISOString(),
            kind: 'alert',
            provider: p.provider,
            dedupeKey: `stale-recovered:${p.provider}:${now.toISOString()}`,
            message: `${p.provider} is reporting again after ${priorStreak} failed collections — its spend is measured once more.`,
            detail: { provider: p.provider, missedCollections: priorStreak },
          },
          CFG.alertDedupeWindowMs,
        )
        emitted += 1
      }
    }
  }

  return {
    state, snapshot, storeMode: storeMode(), emittedEvents: emitted,
    persistentStaleProviders, staleEscalations, recoveredProviders,
  }
}
