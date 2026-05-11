/**
 * Unified Search — 60-second result cache.
 *
 * Cache key: `search:v1:<region>:<q_lowercase_trimmed>`
 * Bypassed whenever price/condition/retailerIds filters are active,
 * since those are rare and the result set would be tiny anyway.
 */

import { TTLCache } from '@/lib/cache'
import type { UnifiedSearchResult } from './types'

const SIXTY_SECONDS = 60 * 1000

// One singleton per Node.js process — shared across concurrent requests.
const unifiedSearchCache = new TTLCache<UnifiedSearchResult>(SIXTY_SECONDS)

export function makeCacheKey(q: string, region: string): string {
  return `search:v1:${region}:${q.toLowerCase().trim()}`
}

export function shouldBypassCache(opts: {
  priceMax?: number
  condition?: string
  retailerIds?: string[]
}): boolean {
  return (
    opts.priceMax    !== undefined ||
    opts.condition   !== undefined ||
    (opts.retailerIds !== undefined && opts.retailerIds.length > 0)
  )
}

export function getCached(key: string): UnifiedSearchResult | null {
  return unifiedSearchCache.get(key)
}

export function setCached(key: string, result: UnifiedSearchResult): void {
  unifiedSearchCache.set(key, result)
}
