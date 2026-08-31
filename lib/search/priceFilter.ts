/**
 * lib/search/priceFilter.ts — the "Under £X" price cap, in one place.
 *
 * Founder review search-2026-08-29-14-02-u3pppa: the search page's cap read a
 * `price.value` field that no search result has ever carried, so every result
 * passed and choosing "Under £15" changed nothing — £16.29 and £24.76 stayed
 * on screen. The cap has to be applied to the price the card actually shows.
 *
 * Pure functions, no React, no I/O — the filter logic is testable on its own
 * (scripts/test-format-and-price-filter.ts) and shared by every list that
 * offers the cap: the result cards and, since founder review
 * search-2026-08-29-14-11-o4rzqw, the "Other listings" and "From eBay" rails
 * beneath them, which used to render outside the filter entirely.
 */

/** Cap options offered in the UI. 'all' means no cap. */
export type PriceCapOption = string

/**
 * Parse a cap option into a number, or null when there is no usable cap
 * ('all', empty, or junk in the URL — an unparseable cap must never filter).
 */
export function parsePriceCap(option: PriceCapOption | null | undefined): number | null {
  if (!option || option === 'all') return null
  const max = parseFloat(option)
  return Number.isFinite(max) && max > 0 ? max : null
}

/**
 * Does a result pass the cap?
 *
 *   number    — a trusted price. Passes when it is at or below the cap.
 *   null      — resolved, but there is no trusted price for this product.
 *               It cannot be shown to a shopper who asked for "Under £15":
 *               we would be implying a price we do not have.
 *   undefined — not resolved yet. Kept, deliberately. Prices load per card
 *               after mount, so hiding an unresolved card would unmount the
 *               fetch that was about to resolve it and strand it forever.
 */
export function withinPriceCap(
  price: number | null | undefined,
  cap: number | null,
): boolean {
  if (cap === null) return true
  if (price === undefined) return true
  if (price === null) return false
  return price <= cap
}
