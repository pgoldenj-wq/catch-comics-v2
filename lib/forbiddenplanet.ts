/**
 * Forbidden Planet affiliate URL builder — Catch Comics
 *
 * Affiliate programme:
 *   Affiliate code appended as ?affiliate=catchcomics (or &affiliate=… when
 *   other query params are already present).
 *
 * ── Env var ───────────────────────────────────────────────────────────────────
 * NEXT_PUBLIC_FORBIDDEN_PLANET_AFFILIATE_CODE=catchcomics
 *
 * NEXT_PUBLIC_ prefix is required for client components (PricingPanel).
 * The affiliate code is NOT a secret — it appears in every outbound URL.
 *
 * ── Live pricing API status ───────────────────────────────────────────────────
 * Forbidden Planet does not offer a public product/pricing API.
 * This integration uses outbound affiliate search links only. No pricing data
 * is fetched or faked. The "View on Forbidden Planet" CTA opens a search on
 * forbiddenplanet.com in a new tab.
 *
 * ── Future expansion ──────────────────────────────────────────────────────────
 * If Forbidden Planet launches a product feed or affiliate API:
 *   1. Add app/api/fp-prices/route.ts that calls the feed and returns listings
 *      in the standard { listings: FPListing[] } shape.
 *   2. Merge results into PricingPanel alongside eBay listings.
 *   3. This helper file stays unchanged — affiliate URL logic is reusable.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** Output shape for a Forbidden Planet affiliate result record. */
export interface ForbiddenPlanetAffiliate {
  source:    'Forbidden Planet'
  type:      'affiliate'
  affiliate: true
  url:       string
}

// ── URL helpers ───────────────────────────────────────────────────────────────

/**
 * Append the affiliate code to any Forbidden Planet URL.
 *
 * Rules:
 *  - URL already has query params → append `&affiliate={code}`
 *  - URL has no query params      → append `?affiliate={code}`
 *  - affiliateCode is empty        → return URL unchanged
 *
 * @example
 * buildForbiddenPlanetAffiliateUrl('https://forbiddenplanet.com/', 'catchcomics')
 * // → 'https://forbiddenplanet.com/?affiliate=catchcomics'
 *
 * buildForbiddenPlanetAffiliateUrl('https://forbiddenplanet.com/?q=Batman', 'catchcomics')
 * // → 'https://forbiddenplanet.com/?q=Batman&affiliate=catchcomics'
 */
export function buildForbiddenPlanetAffiliateUrl(url: string, affiliateCode?: string): string {
  const code = (affiliateCode || '').trim()
  if (!code) return url
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}affiliate=${encodeURIComponent(code)}`
}

/**
 * Build a Forbidden Planet product search URL for a comic title,
 * with the affiliate code appended.
 *
 * Uses the /search/ endpoint (standard Shopify search route).
 * No price or stock data is fetched — this is a deep-link fallback only.
 * FP's /products.json returns 403; do not attempt Shopify ingestion.
 *
 * @param title         - Comic/manga title or ISBN (e.g. "Saga", "9781534313491")
 * @param affiliateCode - From NEXT_PUBLIC_FORBIDDEN_PLANET_AFFILIATE_CODE.
 *                        If empty, returns a clean search URL with no tracking.
 *
 * @example
 * buildForbiddenPlanetSearchUrl('Saga', 'catchcomics')
 * // → 'https://forbiddenplanet.com/search/?q=Saga+comic&affiliate=catchcomics'
 */
export function buildForbiddenPlanetSearchUrl(title: string, affiliateCode?: string): string {
  const q    = encodeURIComponent(`${title.trim()} comic`)
  const base = `https://forbiddenplanet.com/search/?q=${q}`
  return buildForbiddenPlanetAffiliateUrl(base, affiliateCode)
}

/**
 * Build a full ForbiddenPlanetAffiliate result object.
 * Matches the output shape documented in the requirements.
 *
 * @example
 * buildForbiddenPlanetAffiliateResult('Watchmen', 'catchcomics')
 * // → { source: 'Forbidden Planet', type: 'affiliate', affiliate: true,
 * //      url: 'https://forbiddenplanet.com/?q=Watchmen+comic&affiliate=catchcomics' }
 */
export function buildForbiddenPlanetAffiliateResult(
  title: string,
  affiliateCode?: string,
): ForbiddenPlanetAffiliate {
  return {
    source:    'Forbidden Planet',
    type:      'affiliate',
    affiliate: true,
    url:       buildForbiddenPlanetSearchUrl(title, affiliateCode),
  }
}
