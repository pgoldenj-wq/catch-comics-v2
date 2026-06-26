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

// ── Title-match signal (relevance, the dominant ranking driver) ───────────────

const ARTICLE = /^(the|a|an)\s+/

function normTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}
function stripArticle(s: string): string {
  return s.replace(ARTICLE, '').trim()
}
/** Title with a trailing volume/issue/part clause and bare trailing number removed,
 *  so "Saga Volume 1" / "One Piece 110" reduce to the series core "saga" / "one piece". */
function coreTitle(s: string): string {
  let t = normTitle(s)
  t = t.replace(/\b(vol|volume|book|part|chapter|no|number|num)\s*\d+.*$/, '').trim()
  t = t.replace(/\s+\d+\s*$/, '').trim()
  return t
}

/**
 * titleMatchSignal: how strongly the query matches this product's title/series.
 *   1.00 exact   — query equals the title core or series name
 *   0.90 prefix  — title starts with the query
 *   0.75 phrase  — title contains the full query phrase
 *   0.55 tokens  — every query token appears in the title
 *   ≤0.30 partial token overlap   ·   0 = no meaningful overlap
 * Leading articles ("The Sandman" vs "sandman") are matched both ways.
 */
export function titleMatchSignal(
  query: string,
  r: { title: string; seriesName: string | null },
): number {
  const q = normTitle(query)
  if (!q) return 0
  const qBare = stripArticle(q)
  const variants = [...new Set([q, qBare])]
  const multiWord = qBare.includes(' ')

  const cands = new Set<string>()
  for (const base of [r.title, r.seriesName ?? '']) {
    if (!base) continue
    const n = normTitle(base)
    cands.add(n); cands.add(stripArticle(n))
    cands.add(coreTitle(base)); cands.add(stripArticle(coreTitle(base)))
  }

  // exact (title core / series equals the query) — must DECISIVELY beat prefix so
  // the mainline Vol 1 outranks supplementary editions that merely start with the
  // query ("Witch Hat Atelier: Grimoire Edition", "One Piece: Law's Story").
  for (const c of cands) if (variants.includes(c)) return 1.0
  // prefix (title starts with the query word/phrase) — heavily rewarded, but the
  // gap below exact is wide enough that recency/offers can't flip an exact match.
  for (const c of cands) if (variants.some(v => c.startsWith(`${v} `))) return 0.8
  // phrase containment — only a STRONG signal for multi-word queries. A single
  // word buried mid-title ("blade" in "Blood Blade") is weak, not a phrase match.
  if (multiWord) {
    for (const c of cands) {
      if (variants.some(v => c.includes(` ${v} `) || c.endsWith(` ${v}`))) return 0.72
    }
  }

  // token overlap
  const qTokens = qBare.split(' ').filter(Boolean)
  if (!qTokens.length) return 0
  const haystack = new Set(normTitle(`${r.title} ${r.seriesName ?? ''}`).split(' ').filter(Boolean))
  const hits = qTokens.filter(w => haystack.has(w)).length
  if (hits === qTokens.length) return multiWord ? 0.55 : 0.45  // single buried word = weak
  return 0.30 * (hits / qTokens.length)
}

/** Confidence floor: below this, no result strongly matches → honest "weak" state. */
export const STRONG_MATCH_FLOOR = 0.5

// ── Volume-1 / canonical-edition preference ───────────────────────────────────
// For a strong series/title match (a bare series query), steer toward the place
// a new reader begins: Volume 1, then lowest volume, then standalone editions.

/** Volume number parsed from a title ("...Volume 110" / "...Vol. 41") — fallback
 *  for the many products whose DB volumeNumber column is null. */
export function parseVolumeFromTitle(title: string): number | null {
  const m = title.match(/\bvol(?:ume)?\.?\s*(\d{1,4})\b/i)
  return m ? parseInt(m[1], 10) : null
}

function volumePreference(volumeNumber: number | null, title: string, titleMatch: number): number {
  if (titleMatch < 0.7) return 0.5                      // not a series match — neutral
  const vol = volumeNumber ?? parseVolumeFromTitle(title)
  if (vol === null) return 0.85                         // standalone / canonical edition
  if (vol <= 1) return 1.0                              // Volume 1
  return Math.max(0.1, 1.0 - (vol - 1) * 0.06)          // later volumes decay
}

// ── Off-type edition demotion ─────────────────────────────────────────────────
// Colouring/activity/art/guide books, side-stories etc. must not outrank the
// mainline comic for a bare series query — unless the user explicitly asks.
const OFFTYPE = /\b(colou?ring|activity book|sticker|poster|calendar|art of|artbook|art book|guidebook|guide to|handbook|encyclopedia|cookbook|sketchbook|side story|spin[\s-]?off)\b/i
function editionPenalty(title: string, query: string): number {
  if (!OFFTYPE.test(title)) return 0
  if (OFFTYPE.test(query)) return 0   // user explicitly searched for this edition type
  return 0.5
}

export function scoreCanonical(result: CanonicalSearchResult, query: string): number {
  const titleMatch = titleMatchSignal(query, result)
  const textRank   = textRankSignal(result.score)
  const volPref    = volumePreference(result.volumeNumber, result.title, titleMatch)
  const offerCount = offerCountSignal(result.totalOffers)
  const recency    = recencySignal(result.releaseDate)
  const stockAvail = stockAvailSignal(result.offers)
  const trust      = trustSignal(result.offers)
  const penalty    = editionPenalty(result.title, query)

  // Title relevance dominates; volume preference steers series queries to Vol 1;
  // recency/offers/trust are light boosts. Weights (excl. penalty) sum to 1.0.
  return (
    titleMatch * 0.60 +
    textRank   * 0.12 +
    volPref    * 0.15 +
    recency    * 0.04 +
    offerCount * 0.04 +
    stockAvail * 0.03 +
    trust      * 0.02
  ) - penalty
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
 * applyScores: recompute the composite score for each result against the query
 * and return a sorted copy (highest score first).
 */
export function applyScores(results: CanonicalSearchResult[], query: string): CanonicalSearchResult[] {
  return results
    .map(r => ({ ...r, score: scoreCanonical(r, query) }))
    .sort((a, b) => b.score - a.score)
}
