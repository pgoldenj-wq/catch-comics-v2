/**
 * amazon-creators.ts — maps Amazon Creators API items into the shared
 * RetailerListing shape used by every other adapter.
 *
 * ⚠ NO IMPORT RUNS YET. This module only normalises. Nothing here is wired to a
 * cron, an Inngest job, or a sync route, and `toBaseListing` performs no writes.
 * `matchAmazonListing` is the single function that touches the database — it is
 * the seam a future controlled import will call, and is deliberately not
 * invoked by scripts/amazon-creators-test.ts.
 *
 * Existing Amazon listings are never deleted or modified by this module.
 *
 * Retailer row this targets: domain "amazon.co.uk", platform EXTERNAL_API,
 * affiliateNetwork "amazon", affiliateId "catchcomics-21".
 */

import { ListingCondition, MatchMethod, StockStatus } from '@prisma/client'
import { wrapAffiliateUrl } from '@/lib/affiliate'
import { matchCanonical, type BaseListing } from '@/lib/adapters/shared/matching'
import type { AmazonCreatorsItem } from '@/lib/amazonCreators'

/** Bare Amazon product URL for an ASIN on a given marketplace host. */
export function amazonDetailUrl(asin: string, marketplace: string): string {
  const host = marketplace.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  return `https://${host}/dp/${encodeURIComponent(asin)}`
}

/**
 * Amazon offer condition → ListingCondition.
 * Amazon returns "New", "Used", "Collectible", "Refurbished"; used offers carry
 * a sub-condition we do not request, so anything non-New maps to UNGRADED
 * rather than guessing a grade we cannot evidence.
 */
function mapCondition(raw: string | null): ListingCondition {
  if (!raw) return ListingCondition.NEW
  return raw.trim().toLowerCase() === 'new' ? ListingCondition.NEW : ListingCondition.UNGRADED
}

/**
 * Amazon availability → StockStatus.
 * Amazon's availability.type is "Now" when buyable. Anything else is treated as
 * UNKNOWN rather than OUT_OF_STOCK — we never assert absence we cannot prove.
 */
function mapStockStatus(raw: string | null): StockStatus {
  if (!raw) return StockStatus.UNKNOWN
  const v = raw.trim().toLowerCase()
  if (v === 'now' || v.includes('in stock')) return StockStatus.IN_STOCK
  if (v.includes('preorder') || v.includes('pre-order')) return StockStatus.PREORDER
  if (v.includes('out of stock') || v.includes('unavailable')) return StockStatus.OUT_OF_STOCK
  return StockStatus.UNKNOWN
}

/**
 * ASIN → ISBN-13 fallback. For books an ASIN is the ISBN-10, so when Amazon
 * returns no externalIds we can still recover the ISBN-13 by re-checksumming.
 * Returns null for non-book ASINs (which start with "B").
 */
export function isbn13FromAsin(asin: string): string | null {
  const a = asin.trim().toUpperCase()
  if (!/^\d{9}[\dX]$/.test(a)) return null
  const core = `978${a.slice(0, 9)}`
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3)
  const check = (10 - (sum % 10)) % 10
  return `${core}${check}`
}

/**
 * ISBN-13 → ISBN-10, which for books IS the Amazon ASIN.
 *
 * Required because canonical_products.isbn_10 is null for every comic-format
 * row (12,898/12,898 as of 2026-08-02) while isbn_13 is fully populated — so a
 * catalogue-driven Amazon lookup must derive the ASIN rather than read it.
 *
 * Only 978-prefixed ISBN-13s have an ISBN-10 form; 979 titles return null and
 * must be looked up by keyword instead.
 */
export function isbn10FromIsbn13(isbn13: string | null | undefined): string | null {
  if (!isbn13) return null
  const d = isbn13.replace(/\D/g, '')
  if (d.length !== 13 || !d.startsWith('978')) return null

  const core = d.slice(3, 12)
  let sum = 0
  for (let i = 0; i < 9; i++) sum += Number(core[i]) * (10 - i)
  const remainder = (11 - (sum % 11)) % 11
  return `${core}${remainder === 10 ? 'X' : remainder}`
}

export type NormalisedAmazonListing = Omit<
  BaseListing,
  'canonicalProductId' | 'matchMethod' | 'matchConfidence'
>

/**
 * Pure normaliser — no network, no database. Produces the exact shape every
 * other adapter feeds into the shared upsert path.
 *
 * The stored retailerUrl carries the affiliate tag via the existing
 * wrapAffiliateUrl('amazon', …) path, so attribution is identical to the
 * click-time wrapping already used across the site.
 */
export function toBaseListing(
  item: AmazonCreatorsItem,
  opts: { marketplace: string; associateTag: string },
): NormalisedAmazonListing {
  const bareUrl = item.detailPageUrl ?? amazonDetailUrl(item.asin, opts.marketplace)
  const isbn13 = item.isbn13 ?? isbn13FromAsin(item.asin)

  return {
    retailerSku: item.asin,
    retailerUrl: wrapAffiliateUrl(bareUrl, 'amazon', opts.associateTag),
    title: item.title ?? item.asin,
    priceAmount: item.priceAmount ?? '0.00',
    priceCurrency: item.priceCurrency ?? 'GBP',
    stockStatus: mapStockStatus(item.availability),
    condition: mapCondition(item.condition),
    conditionDetail: null,
    imageUrl: item.imageUrl,
    isbn13,
    ean: item.ean,
    rawData: item,
  }
}

/**
 * Attach a canonical-product match to a normalised listing.
 *
 * ⚠ WRITES: delegates to matchCanonical, which may create a stub
 * CanonicalProduct row. Only a controlled, founder-approved import should call
 * this. Not used by the bounded live proof.
 */
export async function matchAmazonListing(
  listing: NormalisedAmazonListing,
): Promise<BaseListing> {
  const match = await matchCanonical(listing.isbn13, listing.ean, listing.title, '[amazon-creators]')
  return { ...listing, ...match }
}

/** Re-exported so callers can assert on match outcomes without a Prisma import. */
export { MatchMethod }
