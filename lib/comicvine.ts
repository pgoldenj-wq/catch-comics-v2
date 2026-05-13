/**
 * Comic Vine API utility — shared fetch + 429 circuit breaker + KV-ready cache.
 *
 * All Comic Vine API calls should go through `cvFetch()` rather than calling
 * `fetch()` directly. This provides:
 *
 *   1. Circuit breaker — a 429 response from Comic Vine trips the breaker for
 *      COOLDOWN_MS (default 60 s). During cooldown, cvFetch() returns null
 *      immediately so callers can return cached/empty results instead of a 500.
 *
 *   2. KV-ready cache — `cvGet` / `cvSet` use Vercel KV when KV_URL is
 *      configured, falling back to the TTLCache singletons for local dev and
 *      deployments where KV hasn't been provisioned yet.
 *      To activate KV: provision a KV store in the Vercel dashboard and set
 *      KV_URL + KV_REST_API_URL + KV_REST_API_TOKEN in the environment.
 *
 *   3. Centralised User-Agent header so every CV request is identifiable.
 */

import { kv }              from '@vercel/kv'
import {
  searchCache,
  volumeCache,
  issueCache,
  volumeIssuesCache,
  autocompleteCache,
  TTLCache,
} from '@/lib/cache'

// ── Circuit breaker ───────────────────────────────────────────────────────────

const COOLDOWN_MS = 60_000  // re-open after 60 s

// Module-level state — one per Node.js process / serverless instance.
let circuitOpenUntil = 0

export function isCircuitOpen(): boolean {
  return Date.now() < circuitOpenUntil
}

/**
 * Fetch a Comic Vine URL with circuit breaker protection.
 *
 * Returns `null` when:
 *   - The circuit is currently open (previous 429)
 *   - Comic Vine responds with 429 (circuit is then opened for COOLDOWN_MS)
 *
 * Throws on other network or non-200 errors — callers should catch.
 */
export async function cvFetch(url: string): Promise<Response | null> {
  if (isCircuitOpen()) {
    const remaining = Math.ceil((circuitOpenUntil - Date.now()) / 1000)
    console.warn(`[comicvine] circuit open — skipping CV request (${remaining}s remaining)`)
    return null
  }

  const res = await fetch(url, {
    headers: { 'User-Agent': 'CatchComics/1.0 (pgoldenj@gmail.com)' },
    // 8-second timeout — CV can be slow; don't hold a serverless slot open longer
    signal: AbortSignal.timeout(8_000),
  })

  if (res.status === 429) {
    // Respect Retry-After if present, else use default cooldown
    const retryAfterHeader = res.headers.get('Retry-After')
    const cooldownMs = retryAfterHeader
      ? Math.min(parseInt(retryAfterHeader, 10) * 1_000, 5 * 60_000)  // cap at 5 min
      : COOLDOWN_MS
    circuitOpenUntil = Date.now() + cooldownMs
    console.warn(
      `[comicvine] 429 — circuit opened for ${Math.ceil(cooldownMs / 1000)}s ` +
      `(until ${new Date(circuitOpenUntil).toISOString()})`
    )
    return null
  }

  return res
}

// ── KV-ready cache ────────────────────────────────────────────────────────────
// When KV_URL is set (Vercel KV provisioned), we use Redis-backed persistence
// so cache survives across serverless cold starts and multiple instances.
// Without KV_URL, we fall through to the in-memory TTLCache singletons.

// @vercel/kv uses KV_REST_API_URL + KV_REST_API_TOKEN (not KV_URL).
// Vercel auto-injects both when a KV store is provisioned; check the one
// the client actually needs so we don't mistakenly activate KV when only
// the raw Redis URL is present (e.g. from a non-KV Redis provider).
const KV_AVAILABLE = !!process.env.KV_REST_API_URL

// TTL map (seconds) for Vercel KV — mirrors the TTLCache constructor values
const KV_TTL: Record<string, number> = {
  search:        24 * 60 * 60,   // 24 h
  autocomplete:   6 * 60 * 60,   // 6 h
  volume:         7 * 24 * 60 * 60,  // 7 d
  issue:          7 * 24 * 60 * 60,  // 7 d
  volumeIssues:   7 * 24 * 60 * 60,  // 7 d
  prices:             60 * 60,   // 1 h
}

function ttlCacheForPrefix(prefix: string): TTLCache<unknown> {
  if (prefix === 'search')       return searchCache
  if (prefix === 'autocomplete') return autocompleteCache
  if (prefix === 'volume' || prefix.startsWith('publisher')) return volumeCache
  if (prefix === 'issue')        return issueCache
  if (prefix === 'volumeIssues') return volumeIssuesCache
  return searchCache  // safe default
}

/**
 * Read from cache.
 * @param prefix  Logical name used to select TTL and local cache bucket.
 * @param key     The full cache key (e.g. "volume:12345").
 */
export async function cvGet<T>(prefix: string, key: string): Promise<T | null> {
  if (KV_AVAILABLE) {
    try {
      const val = await kv.get<T>(key)
      return val ?? null
    } catch (err) {
      console.warn('[comicvine] KV get failed, falling back to memory:', (err as Error).message)
    }
  }
  return ttlCacheForPrefix(prefix).get(key) as T | null
}

/**
 * Write to cache.
 * @param prefix  Logical name used to select TTL and local cache bucket.
 * @param key     The full cache key.
 * @param value   The value to store.
 */
export async function cvSet(prefix: string, key: string, value: unknown): Promise<void> {
  if (KV_AVAILABLE) {
    try {
      const ttlSec = KV_TTL[prefix] ?? 24 * 60 * 60
      await kv.set(key, value, { ex: ttlSec })
      return
    } catch (err) {
      console.warn('[comicvine] KV set failed, falling back to memory:', (err as Error).message)
    }
  }
  ttlCacheForPrefix(prefix).set(key, value)
}
