/**
 * Minimal TTL in-memory cache.
 *
 * Scope: per-process (effective across requests on warm serverless instances and
 * local dev). Does NOT persist across cold starts — acceptable for MVP.
 * Upgrade path: swap backing store for Redis / Vercel KV when needed.
 */

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

export class TTLCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>()
  private readonly defaultTtlMs: number

  constructor(defaultTtlMs: number) {
    this.defaultTtlMs = defaultTtlMs
  }

  get(key: string): T | null {
    const entry = this.store.get(key)
    if (!entry) return null
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return null
    }
    return entry.data
  }

  set(key: string, data: T, ttlMs: number = this.defaultTtlMs): void {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs })
  }

  has(key: string): boolean {
    return this.get(key) !== null
  }
}

const HOUR  = 60 * 60 * 1000
const DAY   = 24 * HOUR
const WEEK  = 7  * DAY

// Module-level singletons — one instance per Node.js process.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const searchCache       = new TTLCache<any>(DAY)        // 24 h — search result pages
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const autocompleteCache = new TTLCache<any>(6 * HOUR)   // 6 h  — autocomplete suggestions
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const volumeCache       = new TTLCache<any>(WEEK)       // 7 d  — volume details & publisher lookups
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const issueCache        = new TTLCache<any>(WEEK)       // 7 d  — individual issue details
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const volumeIssuesCache = new TTLCache<any>(WEEK)       // 7 d  — full issue list for a volume
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const pricesCache       = new TTLCache<any>(HOUR)       // 1 h  — eBay listings (prices change)
