/**
 * scripts/costguard-status.ts — refresh the Mission Control Cost Guard panel.
 *
 * Run: npm run costguard:status        (Command Centre launcher calls this)
 *
 * Reads Cost Guard state + events (KV via .env.local, or the local file
 * fallback) and writes launch/operations/costguard-latest.json — the file
 * launch/mission-control.html fetches. READ-ONLY against providers: this
 * script never calls provider APIs itself; freshness honesty comes from
 * lastCollectionAt in the persisted state.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { COSTGUARD_CONFIG as CFG } from '../lib/costguard/config'
import { getEvents, getState, storeMode } from '../lib/costguard/store'

const OUT = join(process.cwd(), 'launch', 'operations', 'costguard-latest.json')

async function main() {
  const [state, events] = await Promise.all([getState(), getEvents()])
  const now = new Date().toISOString()

  const doc = {
    generatedAt: now,
    storeMode: storeMode(),
    configured: state !== null,
    state: state?.state ?? 'AMBER',
    stateNote: state
      ? undefined
      : 'No Cost Guard state found — collection has never run (or KV env is missing on this machine).',
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
  console.log(`[costguard-status] ${doc.state}${doc.lockdownLatched ? ' (latched)' : ''} → ${OUT}`)
  for (const r of doc.reasons.slice(0, 4)) console.log(`  - ${r}`)
}

main().catch(err => { console.error('[costguard-status] failed:', err); process.exitCode = 1 })
