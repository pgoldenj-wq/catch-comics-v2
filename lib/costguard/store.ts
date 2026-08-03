/**
 * lib/costguard/store.ts — persistence for Cost Guard state, snapshots, events.
 *
 * Primary store: Vercel KV (already used by lib/comicvine.ts — KV_REST_API_URL
 * + KV_REST_API_TOKEN). Tiny payloads: one state doc, one snapshot array per
 * month (capped), one capped event list. Costs pennies; no new infrastructure.
 *
 * Fallback: local JSON files under .costguard-state/ (gitignored) so founder-
 * machine scripts and dev still work when KV env is absent. The fallback is
 * per-machine only — cloud jobs and local scripts share state ONLY via KV.
 *
 * SECURITY: server-side only. Never import from a 'use client' component
 * (scripts/test-costguard.ts enforces this).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CostGuardState, GuardEvent, Snapshot } from './types'

const KEY_STATE     = 'costguard:state'
const KEY_EVENTS    = 'costguard:events'
const keySnapshots  = (monthKey: string) => `costguard:snapshots:${monthKey}`

const MAX_EVENTS            = 300
const MAX_SNAPSHOTS_PER_MO  = 800   // hourly ≈ 744/month

// Resolved lazily at call time — module-load resolution would freeze the cwd
// before test harnesses (or callers) can chdir, pinning state to the wrong dir.
const fallbackDir = () => join(process.cwd(), '.costguard-state')

function kvConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
}

/** Lazy import so environments without the package configured never crash. */
async function kvClient() {
  const mod = await import('@vercel/kv')
  return mod.kv
}

// ── Generic get/set with KV-primary, file-fallback ───────────────────────────

async function readDoc<T>(key: string): Promise<T | null> {
  if (kvConfigured()) {
    try {
      const kv = await kvClient()
      return (await kv.get<T>(key)) ?? null
    } catch (err) {
      console.warn(`[costguard-store] KV read failed for ${key}:`, (err as Error).message)
      return null
    }
  }
  try {
    return JSON.parse(readFileSync(join(fallbackDir(), `${key.replace(/:/g, '_')}.json`), 'utf8')) as T
  } catch {
    return null
  }
}

async function writeDoc<T>(key: string, value: T): Promise<boolean> {
  if (kvConfigured()) {
    try {
      const kv = await kvClient()
      await kv.set(key, value)
      return true
    } catch (err) {
      console.warn(`[costguard-store] KV write failed for ${key}:`, (err as Error).message)
      return false
    }
  }
  // Windows AV scanners can transiently lock fresh files — retry briefly
  // rather than dropping state on the floor.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      mkdirSync(fallbackDir(), { recursive: true })
      writeFileSync(join(fallbackDir(), `${key.replace(/:/g, '_')}.json`), JSON.stringify(value, null, 2))
      return true
    } catch (err) {
      if (attempt === 3) {
        console.warn(`[costguard-store] file write failed for ${key}:`, (err as Error).message)
        return false
      }
      const until = Date.now() + 50 * attempt
      while (Date.now() < until) { /* brief synchronous backoff */ }
    }
  }
  return false
}

// ── Public API ───────────────────────────────────────────────────────────────

export function storeMode(): 'kv' | 'file' {
  return kvConfigured() ? 'kv' : 'file'
}

export async function getState(): Promise<CostGuardState | null> {
  return readDoc<CostGuardState>(KEY_STATE)
}

export async function setState(state: CostGuardState): Promise<boolean> {
  return writeDoc(KEY_STATE, state)
}

export async function getSnapshots(monthKey: string): Promise<Snapshot[]> {
  return (await readDoc<Snapshot[]>(keySnapshots(monthKey))) ?? []
}

export async function appendSnapshot(snap: Snapshot): Promise<boolean> {
  const list = await getSnapshots(snap.monthKey)
  list.push(snap)
  return writeDoc(keySnapshots(snap.monthKey), list.slice(-MAX_SNAPSHOTS_PER_MO))
}

/** Latest Vercel Spend Management webhook report (provider-pushed truth). */
export interface VercelWebhookMemoDoc {
  reportedSpendUsd: number
  limitUsd: number
  pctUsed: number
  at: string
}

export async function getVercelWebhookMemo(): Promise<VercelWebhookMemoDoc | null> {
  return readDoc<VercelWebhookMemoDoc>('costguard:vercel-webhook-memo')
}

export async function setVercelWebhookMemo(memo: VercelWebhookMemoDoc): Promise<boolean> {
  return writeDoc('costguard:vercel-webhook-memo', memo)
}

export async function getEvents(): Promise<GuardEvent[]> {
  return (await readDoc<GuardEvent[]>(KEY_EVENTS)) ?? []
}

/**
 * Append an event with dedupe: an event whose dedupeKey matches one recorded
 * inside `dedupeWindowMs` is dropped (returns false). Recovery/state-change
 * events pass a unique key so they are never suppressed.
 */
export async function appendEvent(
  event: GuardEvent,
  dedupeWindowMs: number,
): Promise<boolean> {
  const events = await getEvents()
  if (event.dedupeKey) {
    const cutoff = Date.now() - dedupeWindowMs
    const dup = events.some(
      e => e.dedupeKey === event.dedupeKey && Date.parse(e.at) > cutoff,
    )
    if (dup) return false
  }
  events.push(event)
  await writeDoc(KEY_EVENTS, events.slice(-MAX_EVENTS))
  return true
}
