/**
 * Unified Search — shared TypeScript types.
 *
 * These types flow from the lib/search functions through the API route
 * and into the search page. Keeping them in one place makes the contract explicit.
 */

// ── Query ─────────────────────────────────────────────────────────────────────

export interface SearchQuery {
  /** Raw text the user typed */
  q: string
  /** 'uk' | 'us' — determines eBay marketplace and currency display */
  region: 'uk' | 'us'
  /** Optional: only return offers below this price (in the region's currency) */
  priceMax?: number
  /** Optional: filter by ListingCondition values */
  condition?: string
  /** Optional: filter to specific retailer UUIDs */
  retailerIds?: string[]
  /** 1-based page number (default 1) */
  page?: number
  /** Results per page (default 20) */
  pageSize?: number
}

// ── Result shapes ─────────────────────────────────────────────────────────────

/** A single retailer price offer for a canonical product */
export interface SearchOffer {
  listingId:    string
  retailerId:   string
  retailerName: string
  retailerUrl:  string
  priceAmount:  number
  currency:     string
  stockStatus:  string    // 'IN_STOCK' | 'OUT_OF_STOCK' | etc.
  condition:    string    // 'NEW' | 'VERY_GOOD' | etc.
  /** 0–100 retailer trust score */
  trustScore:   number
  /** ISO timestamp of when the listing was last seen */
  lastSeenAt:   string
}

/** A canonical product with matching offers attached */
export interface CanonicalSearchResult {
  type:         'canonical'
  id:           string
  title:        string
  seriesName:   string | null
  publisher:    string | null
  format:       string       // ProductFormat enum value
  isbn13:       string | null
  coverImageUrl: string | null
  /** CV volume/issue id when matched — lets search cards use the same live
   *  CV cover fallback the product hero uses (CC-027). */
  comicvineId:  string | null
  canonicalSlug: string
  /** Volume number (1-based) when known — drives Vol-1 preference for series queries */
  volumeNumber: number | null
  releaseDate:  string | null  // ISO date string
  /** Top 5 in-stock offers, sorted cheapest first */
  offers:       SearchOffer[]
  /** Number of total offers (including out-of-stock) */
  totalOffers:  number
  /** Composite ranking score (internal, exposed for debug) */
  score:        number
}

/** An unmatched retailer listing (canonical_product_id IS NULL) */
export interface UnmatchedListing {
  type:         'unmatched'
  id:           string
  title:        string
  retailerId:   string
  retailerName: string
  retailerUrl:  string
  priceAmount:  number
  currency:     string
  condition:    string
  stockStatus:  string
  imageUrl:     string | null
  lastSeenAt:   string
}

/** A live eBay result that didn't match any canonical product */
export interface LooseEbayResult {
  type:       'ebay'
  itemId:     string
  title:      string
  price:      number
  currency:   string
  condition:  string
  imageUrl:   string
  itemWebUrl: string
  seller:     { username: string; feedbackPercentage: number }
}

export interface SearchFacets {
  formats:    { value: string; count: number }[]
  publishers: { value: string; count: number }[]
  conditions: { value: string; count: number }[]
  /** Min/max price in results */
  priceRange: { min: number; max: number } | null
}

// ── Unified response ──────────────────────────────────────────────────────────

export interface UnifiedSearchResult {
  type:               'unified'
  query:              string
  /** Products with canonical records + in-stock offers */
  canonicalResults:   CanonicalSearchResult[]
  /** Retailer listings not yet matched to a canonical product */
  unmatchedListings:  UnmatchedListing[]
  /** Live eBay listings not matched to any canonical product */
  looseEbayResults:   LooseEbayResult[]
  facets:             SearchFacets
  total:              number
  /** True when no canonical result strongly matches the query (best title-match
   *  below the confidence floor). The UI shows an honest "no strong match" state
   *  instead of presenting weak fuzzy results as confident answers. */
  weakMatch:          boolean
  /** Debug info (timings, source counts) */
  debug?: {
    durationMs:      number
    queryACount:     number
    queryBCount:     number
    queryCCount:     number
    cacheHit:        boolean
  }
}
