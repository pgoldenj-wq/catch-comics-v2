/**
 * scripts/costguard-status.ts — refresh the Mission Control Cost Guard panel.
 *
 * Run: npm run costguard:status        (Command Centre launcher calls this)
 *
 * Reads Cost Guard state + events — preferring the deployed production state
 * endpoint, where the scheduled job actually collects, and falling back to the
 * local store — then writes launch/operations/costguard-latest.json, the file
 * launch/mission-control.html fetches. READ-ONLY against providers: this
 * script never calls provider APIs itself; freshness honesty comes from
 * lastCollectionAt plus the `source` field in the persisted state.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { COSTGUARD_CONFIG as CFG } from '../lib/costguard/config'
import { getEvents, getState, storeMode } from '../lib/costguard/store'
import type { CostGuardState, GuardEvent } from '../lib/costguard/types'

const OUT = join(process.cwd(), 'launch', 'operations', 'costguard-latest.json')
const REMOTE = process.env.COSTGUARD_STATE_URL
  ?? 'https://www.catchcomics.com/api/costguard/state'

/**
 * Production is the source of truth: the scheduled job collects into Vercel KV,
 * which a founder machine without KV env cannot see. Read the deployed state
 * endpoint whenever the cron secret is available and fall back to the local
 * store otherwise — recording which one was used, so a stale local file can
 * never masquerade as live production data on the Mission Control panel.
 */
async function readProduction(): Promise<
  { state: CostGuardState | null; events: GuardEvent[] } | null
> {
  const secret = process.env.COSTGUARD_CRON_SECRET
  if (!secret) return null
  try {
    const res = await fetch(REMOTE, {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      console.warn(`[costguard-status] production state HTTP ${res.status} — falling back to the local store.`)
      return null
    }
    const json = await res.json() as { state?: CostGuardState | null; events?: GuardEvent[] }
    return { state: json.state ?? null, events: json.events ?? [] }
  } catch (err) {
    console.warn(`[costguard-status] production state unreachable (${(err as Error).message}) — falling back to the local store.`)
    return null
  }
}

async function main() {
  const remote = await readProduction()
  const [state, events] = remote
    ? [remote.state, remote.events]
    : await Promise.all([getState(), getEvents()])
  const source: 'production' | 'local' = remote ? 'production' : 'local'
  const now = new Date().toISOString()

  const doc = {
    generatedAt: now,
    source,
    storeMode: remote ? 'kv' : storeMode(),
    configured: state !== null,
    state: state?.state ?? 'AMBER',
    stateNote: state
      ? undefined
      : source === 'production'
        ? 'Production has no Cost Guard state yet — collection has never run there.'
        : 'No Cost Guard state found locally — collection has never run, or COSTGUARD_CRON_SECRET/KV env is missing on this machine.',
    since: state?.since ?? null,
    lockdownLatched: state?.lockdownLatched ?? false,
    reasons: state?.reasons ?? ['No telemetry yet.'],
    lastCollectionAt: state?.lastCollectionAt ?? null,
    dataAgeHours: state?.lastCollectionAt
      ? Number(((Date.now() - Date.parse(state.lastCollectionAt)) / 3_600_000).toFixed(1))
      : null,
    staleProviders: state?.staleProviders ?? [],
    unconfiguredProviders: state?.unconfiguredProviders ?? ['neon', 'vercel', 'github', 'cloudflare'],
    totals: state?.totals ?? null,
    perProvider: state?.perProvider ?? [],
    activeRestrictions: state?.activeRestrictions ?? [],
    budgets: {
      global: CFG.global,
      providers: CFG.providers,
    },
    recentEvents: events.slice(-25).reverse(),
  }

  mkdirSync(join(process.cwd(), 'launch', 'operations'), { recursive: true })
  writeFileSync(OUT, JSON.stringify(doc, null, 2))
  console.log(`[costguard-status] ${doc.state}${doc.lockdownLatched ? ' (latched)' : ''} (source: ${source}) → ${OUT}`)
  for (const r of doc.reasons.slice(0, 4)) console.log(`  - ${r}`)
}

main().catch(err => { console.error('[costguard-status] failed:', err); process.exitCode = 1 })
