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
  /** Max live entries; 0 = unbounded (legacy default). */
  private readonly maxSize: number

  constructor(defaultTtlMs: number, maxSize: number = 0) {
    this.defaultTtlMs = defaultTtlMs
    this.maxSize = maxSize
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
    // Re-insert at the tail so insertion order tracks recency of writes.
    this.store.delete(key)
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs })

    // Evict oldest entries once over the cap. Map preserves insertion order,
    // so the first key is the oldest write — FIFO eviction bounds memory.
    if (this.maxSize > 0) {
      while (this.store.size > this.maxSize) {
        const oldest = this.store.keys().next().value
        if (oldest === undefined) break
        this.store.delete(oldest)
      }
    }
  }

  has(key: string): boolean {
    return this.get(key) !== null
  }
}

const HOUR  = 60 * 60 * 1000
const DAY   = 24 * HOUR
const WEEK  = 7  * DAY

// Cap the search-result caches: their per-entry payload is large (a full search
// page of products + offers) and grew when queryA's product LIMIT went to 80.
// Bounding entry count keeps a warm serverless instance's memory in check.
const SEARCH_CACHE_MAX = 1000

// Module-level singletons — one instance per Node.js process.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const searchCache       = new TTLCache<any>(DAY, SEARCH_CACHE_MAX)  // 24 h — search result pages
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
