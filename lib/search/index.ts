/**
 * Unified Search — main orchestrator.
 *
 * Runs Query A (canonical products), Query B (unmatched listings), and
 * Query C (live eBay) in parallel via Promise.all, then:
 *   1. Merges eBay ISBN matches into their canonical products
 *   2. Applies composite scoring + stale-dud sanity floor
 *   3. Computes facets from the canonical result set
 *   4. Returns the full UnifiedSearchResult shape
 *
 * Caching: 60-second per-process cache (bypassed when filters are set).
 */

import { queryCanonical }                    from './queryA'
import { queryUnmatched }                    from './queryB'
import { queryEbay }                         from './queryC'
import { applyScores, isStaleDud, titleMatchSignal, STRONG_MATCH_FLOOR } from './score'
import { makeCacheKey, shouldBypassCache, getCached, setCached } from './cache'
import type {
  SearchQuery, UnifiedSearchResult, CanonicalSearchResult,
  SearchOffer, SearchFacets,
} from './types'

// ── ISBN detection (mirrors route.ts — kept local to avoid cross-layer import) ─

function isIsbnQuery(q: string): boolean {
  const stripped = q.replace(/[\s\-]/g, '')
  return /^\d{13}$/.test(stripped) || /^\d{9}[\dXx]$/.test(stripped)
}

// ── Facet computation ─────────────────────────────────────────────────────────

function computeFacets(canonicals: CanonicalSearchResult[]): SearchFacets {
  const formats    = new Map<string, number>()
  const publishers = new Map<string, number>()
  const conditions = new Map<string, number>()
  let   priceMin   = Infinity
  let   priceMax   = -Infinity

  for (const r of canonicals) {
    // Format
    formats.set(r.format, (formats.get(r.format) ?? 0) + 1)

    // Publisher
    const pub = r.publisher ?? 'Unknown'
    publishers.set(pub, (publishers.get(pub) ?? 0) + 1)

    // Conditions and price range from offers
    for (const o of r.offers) {
      conditions.set(o.condition, (conditions.get(o.condition) ?? 0) + 1)
      if (o.priceAmount < priceMin) priceMin = o.priceAmount
      if (o.priceAmount > priceMax) priceMax = o.priceAmount
    }
  }

  const toArr = (m: Map<string, number>) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, count }))

  return {
    formats:    toArr(formats),
    publishers: toArr(publishers).slice(0, 20),
    conditions: toArr(conditions),
    priceRange: priceMin === Infinity ? null : { min: priceMin, max: priceMax },
  }
}

// ── Merge matched eBay offers into canonical results ──────────────────────────

function mergeEbayMatches(
  canonicals:  CanonicalSearchResult[],
  ebayMatched: Awaited<ReturnType<typeof queryEbay>>['matched'],
): CanonicalSearchResult[] {
  if (ebayMatched.length === 0) return canonicals

  // Index canonicals by id for O(1) lookup
  const byId = new Map<string, CanonicalSearchResult>(
    canonicals.map(r => [r.id, r])
  )

  for (const { canonicalProductId, listing } of ebayMatched) {
    const canonical = byId.get(canonicalProductId)
    if (!canonical) continue

    // Synthesise an eBay offer — no retailer row, so use eBay-specific fields
    const ebayOffer: SearchOffer = {
      listingId:    listing.itemId,
      retailerId:   'ebay',
      retailerName: 'eBay',
      retailerUrl:  listing.itemWebUrl,
      priceAmount:  listing.price.value,
      currency:     listing.price.currency,
      stockStatus:  'IN_STOCK',
      condition:    listing.condition,
      trustScore:   60,                   // fixed trust for marketplace listings
      lastSeenAt:   new Date().toISOString(),
    }

    // Add to offers if we have fewer than 5 (or if it's cheaper than the 5th)
    const offers = [...canonical.offers]
    if (offers.length < 5) {
      offers.push(ebayOffer)
      offers.sort((a, b) => a.priceAmount - b.priceAmount)
    } else if (ebayOffer.priceAmount < offers[offers.length - 1].priceAmount) {
      offers[offers.length - 1] = ebayOffer
      offers.sort((a, b) => a.priceAmount - b.priceAmount)
    }

    byId.set(canonicalProductId, {
      ...canonical,
      offers,
      totalOffers: canonical.totalOffers + 1,
    })
  }

  return [...byId.values()]
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function unifiedSearch(sq: SearchQuery): Promise<UnifiedSearchResult> {
  const start   = Date.now()
  const cacheKey = makeCacheKey(sq.q, sq.region)
  const bypass   = shouldBypassCache(sq)

  if (!bypass) {
    const cached = getCached(cacheKey)
    if (cached) {
      return {
        ...cached,
        debug: {
          durationMs:  cached.debug?.durationMs  ?? 0,
          queryACount: cached.debug?.queryACount ?? 0,
          queryBCount: cached.debug?.queryBCount ?? 0,
          queryCCount: cached.debug?.queryCCount ?? 0,
          cacheHit:    true,
        },
      }
    }
  }

  // Run all three queries in parallel
  const [rawCanonicals, unmatched, ebayResult] = await Promise.all([
    queryCanonical(sq).catch(err => {
      console.error('[search/queryA] error:', err)
      return [] as CanonicalSearchResult[]
    }),
    queryUnmatched(sq).catch(err => {
      console.error('[search/queryB] error:', err)
      return []
    }),
    queryEbay(sq).catch(err => {
      console.error('[search/queryC] error:', err)
      return { matched: [], loose: [] }
    }),
  ])

  // Merge eBay ISBN matches into canonical results
  const merged = mergeEbayMatches(rawCanonicals, ebayResult.matched)

  // Score + sort. Stale duds sink to the bottom of the canonical bucket.
  let scored = applyScores(merged, sq.q)

  // ISBN exact-match pinning: when the query is a bare ISBN, the first result
  // from queryA already has ts_rank=1.0 / trgm_sim=1.0 (set in queryA), but
  // applyScores weights those against offer count, recency, etc., which can
  // push the match down when the product is out-of-stock. Force it to rank #1
  // with a perfect score so the user always sees the ISBN match at the top.
  if (isIsbnQuery(sq.q) && scored.length > 0) {
    const isbnClean = sq.q.replace(/[\s\-]/g, '')
    const isIsbn13  = /^\d{13}$/.test(isbnClean)
    const matchIdx  = scored.findIndex(r =>
      isIsbn13
        ? r.isbn13 === isbnClean
        : r.isbn13 !== null  // ISBN-10: queryA returned it, first result is the match
    )
    if (matchIdx > 0) {
      // Splice the match out and prepend it with score 1.0
      const [match] = scored.splice(matchIdx, 1)
      scored = [{ ...match, score: 1.0 }, ...scored]
    } else if (matchIdx === 0 && scored[0].score < 1.0) {
      // Already first but score may be deflated — pin it
      scored[0] = { ...scored[0], score: 1.0 }
    }
  }

  const freshOnes = scored.filter(r => !isStaleDud(r))
  const staleOnes = scored.filter(r =>  isStaleDud(r))
  const canonicals = [...freshOnes, ...staleOnes]

  const facets = computeFacets(canonicals)
  const total  = canonicals.length + unmatched.length + ebayResult.loose.length

  // Fuzzy honesty: the query is a "weak match" when no canonical result strongly
  // matches the title (best title-match below the floor). ISBN queries are exact
  // by construction and never weak. The UI uses this to show an honest
  // "no strong match" state instead of presenting fuzzy results as confident.
  // Use the STRONGEST title match across the whole set, not canonicals[0]: the
  // top-by-composite-score result isn't necessarily the best title match (volume
  // preference can reorder), and this stays correct if offer-staleness ever
  // reorders the bucket. weakMatch means "nothing in the catalogue matches well".
  const bestTitleMatch = canonicals.length
    ? Math.max(...canonicals.map(c => titleMatchSignal(sq.q, c)))
    : 0
  const weakMatch = !isIsbnQuery(sq.q) && bestTitleMatch < STRONG_MATCH_FLOOR

  const result: UnifiedSearchResult = {
    type:              'unified',
    query:             sq.q,
    canonicalResults:  canonicals,
    unmatchedListings: unmatched,
    looseEbayResults:  ebayResult.loose,
    facets,
    total,
    weakMatch,
    debug: {
      durationMs:  Date.now() - start,
      queryACount: rawCanonicals.length,
      queryBCount: unmatched.length,
      queryCCount: ebayResult.loose.length + ebayResult.matched.length,
      cacheHit:    false,
    },
  }

  if (!bypass) {
    setCached(cacheKey, result)
  }

  return result
}
