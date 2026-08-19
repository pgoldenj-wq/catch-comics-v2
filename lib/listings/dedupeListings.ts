/**
 * lib/listings/dedupeListings.ts — one trusted offer per retailer where a
 * retailer has duplicate listings for the same product.
 *
 * Why this exists: the Lets Buy Books feed was ingested by two writers with
 * different SKU schemes — the gated CLI sync keys listings on ISBN-13, while
 * the (now-disabled) hourly adapter keyed them on the merchant's own 14-digit
 * product id. Both rows point at the same canonical product, so the offer
 * table showed "Lets Buy Books" twice at the same price (31 products affected
 * at containment time, 2026-07-16).
 *
 * Travelling Man was added on 2026-08-19. Its duplicates have a different
 * cause — the shop carries two product pages for the same book (a reissue
 * handle alongside the original, e.g. `elephantmen-volume-2-fatal-diseases`
 * and `elephantmen-volume-02-hardcover`) — but the customer-facing damage is
 * identical, and worse in one case: The Ancient Magus' Bride Volume 22 showed
 * two Travelling Man rows, £9.99 in stock at the correct URL and £11.99 out of
 * stock at a URL for *Volume 23*. Two rows from one shop were being counted
 * and labelled as "2 tracked retailers", which overstates comparison depth,
 * and the losing row sent customers to the wrong volume.
 *
 * This is DISPLAY-LEVEL suppression: no rows are deleted or modified, other
 * retailers are untouched, and the /go redirect keeps working for every
 * listing id.
 *
 * Preference within a duplicate group:
 *   1. the listing whose retailerSku is a checksum-valid ISBN-13
 *      (written by the trusted gated sync)
 *   2. otherwise the most recently seen listing
 *
 * Pure function, no I/O. Tests: scripts/test-lbb-containment.ts.
 */

import { normalizeIsbn13 } from '../identity/edition'

/** Retailer domains whose duplicate listings are suppressed at display time. */
const DEDUPE_DOMAINS = new Set(['letsbuybooks.com', 'travellingman.com'])

export interface DedupableListing {
  retailerSku: string
  lastSeenAt:  Date
  retailer:    { domain?: string | null }
}

/**
 * Collapse duplicate listings from DEDUPE_DOMAINS retailers down to one per
 * retailer, preserving the input order of every listing that survives.
 * Listings from other retailers pass through untouched.
 */
export function suppressDuplicateRetailerListings<T extends DedupableListing>(listings: T[]): T[] {
  // Pick the winner for each deduped retailer domain present in the list.
  const winners = new Map<string, T>()
  for (const l of listings) {
    const domain = l.retailer.domain
    if (!domain || !DEDUPE_DOMAINS.has(domain)) continue
    const current = winners.get(domain)
    if (!current || beats(l, current)) winners.set(domain, l)
  }
  if (winners.size === 0) return listings

  return listings.filter(l => {
    const domain = l.retailer.domain
    if (!domain || !DEDUPE_DOMAINS.has(domain)) return true
    return winners.get(domain) === l
  })
}

/** Does listing `a` beat listing `b` for the single displayed slot? */
function beats(a: DedupableListing, b: DedupableListing): boolean {
  const aIsbn = normalizeIsbn13(a.retailerSku) !== null
  const bIsbn = normalizeIsbn13(b.retailerSku) !== null
  if (aIsbn !== bIsbn) return aIsbn
  return a.lastSeenAt.getTime() > b.lastSeenAt.getTime()
}
