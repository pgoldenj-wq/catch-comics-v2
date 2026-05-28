/**
 * Unified Search — composite result scoring.
 *
 * Formula (weights sum to 1.0):
 *   textRank    × 0.55  — FTS + trgm signal from Postgres (primary signal)
 *   recency     × 0.15  — how recently the product was released
 *   offerCount  × 0.12  — log-damped in-stock offer count (boost, not gate)
 *   stockAvail  × 0.10  — fraction of offers that are in-stock
 *   trustScore  × 0.08  — average retailer trust score across offers
 *
 * Philosophy: text relevance drives ranking. Pricing signals are a boost
 * for products that happen to be priced, not a penalty for unlisted ones.
 * A well-matched catalogue entry (no current price) should outrank a
 * weakly-matched priced result.
 *
 * isStaleDud: products with no in-stock offers are catalogue entries and
 * are NOT demoted below eBay scrapes. They sort by score like everything
 * else. Only products with offer records that are all stale (> 30 days
 * since last seen) are demoted.
 */

import type { CanonicalSearchResult } from './types'

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

/**
 * textRankSignal: normalised 0–1 from the raw Postgres score (0–1 float).
 * Already in [0,1] from ts_rank; no transformation needed.
 */
function textRankSignal(score: number): number {
  return clamp01(score)
}

/**
 * offerCountSignal: log2 dampened 0–1.
 * 0 offers → 0.0, 1 → ~0.25, 5 → ~0.57, 20 → ~0.86, ∞ → 1.0 (approx)
 */
function offerCountSignal(n: number): number {
  if (n <= 0) return 0
  return clamp01(Math.log2(n + 1) / Math.log2(21))  // 20 offers → ~1.0
}

/**
 * recencySignal: based on releaseDate or a fallback of "now".
 * Products released within the last year score highest.
 * Products older than 5 years still contribute (floor 0.1).
 */
function recencySignal(releaseDate: string | null): number {
  if (!releaseDate) return 0.3   // Unknown date — neutral
  const ageMs  = Date.now() - new Date(releaseDate).getTime()
  const ageDays = ageMs / (24 * 60 * 60 * 1000)
  if (ageDays < 0)    return 1.0                           // future / preorder
  if (ageDays < 30)   return 1.0
  if (ageDays < 365)  return 0.8
  if (ageDays < 730)  return 0.6
  if (ageDays < 1825) return 0.4                           // < 5 years
  return 0.1
}

/**
 * stockAvailSignal: fraction of offers that are in-stock (out of top 5 shown).
 */
function stockAvailSignal(offers: CanonicalSearchResult['offers']): number {
  if (offers.length === 0) return 0
  const inStock = offers.filter(o => o.stockStatus === 'IN_STOCK' || o.stockStatus === 'LOW_STOCK').length
  return inStock / offers.length
}

/**
 * trustSignal: average trust score across all offers, normalised 0–1.
 */
function trustSignal(offers: CanonicalSearchResult['offers']): number {
  if (offers.length === 0) return 0.5  // neutral when no offers
  const avg = offers.reduce((sum, o) => sum + o.trustScore, 0) / offers.length
  return avg / 100
}

export function scoreCanonical(result: CanonicalSearchResult): number {
  const textRank   = textRankSignal(result.score)
  const offerCount = offerCountSignal(result.totalOffers)
  const recency    = recencySignal(result.releaseDate)
  const stockAvail = stockAvailSignal(result.offers)
  const trust      = trustSignal(result.offers)

  // Weights sum to 1.0: 0.55 + 0.15 + 0.12 + 0.10 + 0.08 = 1.00
  return (
    textRank   * 0.55 +
    recency    * 0.15 +
    offerCount * 0.12 +
    stockAvail * 0.10 +
    trust      * 0.08
  )
}

/**
 * isStaleDud: true only when a product has offer records that are all
 * out-of-stock AND were last seen more than 30 days ago.
 *
 * Products with ZERO offers are catalogue entries (never listed, or not yet
 * in any feed). They are NOT duds — they should surface on text relevance.
 * Previously returning true immediately for offers.length === 0 caused all
 * unlisted comics to be buried below eBay scrapes. That was wrong for a
 * database-first model.
 *
 * Note: queryA.ts only hydrates IN_STOCK/LOW_STOCK/PREORDER offers, so
 * offers.length > 0 already implies current availability. The inStock check
 * is defensive for when queryA is extended to include OOS offers.
 */
export function isStaleDud(result: CanonicalSearchResult): boolean {
  // Zero offers = catalogue entry, not a stale listing. Never a dud.
  if (result.offers.length === 0) return false

  // Has in-stock/preorder offers — definitely not stale.
  const inStock = result.offers.some(
    o => o.stockStatus === 'IN_STOCK' || o.stockStatus === 'LOW_STOCK' || o.stockStatus === 'PREORDER'
  )
  if (inStock) return false

  // Has offer records but none are in-stock. Check staleness.
  const mostRecentMs = Math.max(
    ...result.offers.map(o => new Date(o.lastSeenAt).getTime())
  )
  return Date.now() - mostRecentMs > THIRTY_DAYS_MS
}

/**
 * applyScores: mutate the score field in-place and return a sorted copy.
 */
export function applyScores(results: CanonicalSearchResult[]): CanonicalSearchResult[] {
  return results
    .map(r => ({ ...r, score: scoreCanonical(r) }))
    .sort((a, b) => b.score - a.score)
}
