/**
 * Unified Search — composite result scoring.
 *
 * Formula (weights sum to 1.0):
 *   textRank    × 0.40  — FTS + trgm signal from Postgres
 *   offerCount  × 0.20  — log-damped in-stock offer count
 *   recency     × 0.10  — how recently the product was released (or last seen)
 *   stockAvail  × 0.15  — fraction of offers that are in-stock
 *   trustScore  × 0.15  — average retailer trust score across offers
 *
 * Sanity floor: products with zero in-stock offers and last-seen > 7 days
 * ago are demoted below unmatched listings and loose eBay results.
 */

import type { CanonicalSearchResult } from './types'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

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

  return (
    textRank   * 0.40 +
    offerCount * 0.20 +
    recency    * 0.10 +
    stockAvail * 0.15 +
    trust      * 0.15
  )
}

/**
 * isStaleDud: true when a canonical product has no in-stock offers
 * AND all offers were last seen more than 7 days ago.
 * Stale duds are sorted below loose eBay results.
 */
export function isStaleDud(result: CanonicalSearchResult): boolean {
  if (result.offers.length === 0) return true

  const inStock = result.offers.some(
    o => o.stockStatus === 'IN_STOCK' || o.stockStatus === 'LOW_STOCK'
  )
  if (inStock) return false

  const mostRecentMs = Math.max(
    ...result.offers.map(o => new Date(o.lastSeenAt).getTime())
  )
  return Date.now() - mostRecentMs > SEVEN_DAYS_MS
}

/**
 * applyScores: mutate the score field in-place and return a sorted copy.
 */
export function applyScores(results: CanonicalSearchResult[]): CanonicalSearchResult[] {
  return results
    .map(r => ({ ...r, score: scoreCanonical(r) }))
    .sort((a, b) => b.score - a.score)
}
