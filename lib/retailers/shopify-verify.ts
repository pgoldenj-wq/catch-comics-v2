/**
 * shopify-verify.ts — live Shopify price/availability verification.
 *
 * This is the verification core extracted verbatim from
 * scripts/price-verify-dryrun.ts (the proven August/November runs) so that more
 * than one operational script can share ONE implementation of the identity
 * rules rather than drifting copies of them.
 *
 * Identity rules are the existing ones, unchanged:
 *   - retailer_sku "<productId>-<variantId>" → that exact variant must exist.
 *     No substitution. Absent ⇒ `variantMissing`.
 *   - retailer_sku "<productId>" → the product-level listing, resolved by the
 *     adapter's existing primary rule (first available variant, else the
 *     first) — see lib/adapters/shopify.ts expandProduct().
 *   - The live product id must equal the stored product id, or the row is
 *     `productIdMismatch`. Handles are never trusted as identity on their own.
 *   - No fuzzy title matching, no ISBN re-derivation, no new matches.
 *
 * A failed request is NEVER fresh and NEVER out-of-stock: transient/throttle
 * failures get their own class and must be excluded from any writable set.
 *
 * This module performs HTTP reads only. It never touches the database.
 */

/** Shared request/byte accounting. Callers read this for their cost report. */
export const cost = {
  /** First attempts only. */
  productRequests: 0,
  retryRequests:   0,
  inboundBytes:    0,
}

/** Reset the shared counters (used by tests). */
export function resetCost(): void {
  cost.productRequests = 0
  cost.retryRequests   = 0
  cost.inboundBytes    = 0
}

export const USER_AGENT      = 'CatchComics/1.0 (+https://catchcomics.com/bot)'
export const MAX_RETRIES     = 3
export const BACKOFF_BASE_MS = 2_000

/**
 * Price-plausibility ceiling. A verified read is still refused if the live
 * value is nonsensical or moves by more than this factor in either direction —
 * a bounded refresh must never launder a scraping artefact into a
 * customer-facing price.
 */
export const MAX_PRICE_RATIO = 10

export type VerifyKlass =
  | 'availableUnchanged' | 'availablePriceChanged' | 'unavailable'
  | 'variantMissing' | 'productIdMismatch' | 'notFound'
  | 'transient' | 'otherError'

/** The three classes that represent a successful, trustworthy live read. */
export const VERIFIED_KLASSES: readonly VerifyKlass[] =
  ['availableUnchanged', 'availablePriceChanged', 'unavailable']

/**
 * The two classes that represent a live offer a customer can actually buy.
 * `unavailable` is a trustworthy read but NOT a purchasable offer.
 */
export const PURCHASABLE_KLASSES: readonly VerifyKlass[] =
  ['availableUnchanged', 'availablePriceChanged']

export interface VerifyRowInput {
  id: string
  retailerSku: string
  retailerUrl: string
  priceAmount: unknown
}

export interface VerifyRowResult {
  id: string
  sku: string
  klass: VerifyKlass
  /** Stored price, as a string. */
  stored: string
  /** Live price to 2dp, or null when nothing trustworthy was read. */
  live: string | null
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Extract the Shopify product handle from a stored product URL. */
export function handleOf(url: string): string | null {
  const m = /\/products\/([^/?#]+)/.exec(url)
  return m ? decodeURIComponent(m[1]).toLowerCase() : null
}

/** Pull every <loc> out of a sitemap document. */
export function extractLocs(xml: string): string[] {
  const out: string[] = []
  const re = /<loc>([\s\S]*?)<\/loc>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
  }
  return out
}

/**
 * Fetch with the adapter's bounded retry policy. 429 and 5xx are transient and
 * retried with doubling backoff, honouring Retry-After when present.
 */
export async function fetchRaw(
  url: string,
  accept: string,
): Promise<{ status: number; text: string; transient: boolean }> {
  let backoff = BACKOFF_BASE_MS
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept } })
    if (res.status === 429 || res.status >= 500) {
      if (attempt === MAX_RETRIES) return { status: res.status, text: '', transient: true }
      const ra = Number(res.headers.get('retry-after'))
      const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1_000 : backoff
      cost.retryRequests++
      await sleep(waitMs)
      backoff *= 2
      continue
    }
    const text = await res.text()
    cost.inboundBytes += Buffer.byteLength(text)
    return { status: res.status, text, transient: false }
  }
  return { status: 0, text: '', transient: true }
}

/** Verify one stored row against the live product endpoint. */
export async function verifyRow(
  domain: string,
  row: VerifyRowInput,
): Promise<VerifyRowResult> {
  const handle = handleOf(row.retailerUrl)
  const stored = String(row.priceAmount)
  const base: Omit<VerifyRowResult, 'klass' | 'live'> = { id: row.id, sku: row.retailerSku, stored }
  if (!handle) return { ...base, klass: 'otherError', live: null }

  cost.productRequests++
  const res = await fetchRaw(`https://${domain}/products/${handle}.js`, 'application/json')

  if (res.transient)      return { ...base, klass: 'transient',  live: null }
  if (res.status === 404) return { ...base, klass: 'notFound',   live: null }
  if (res.status !== 200) return { ...base, klass: 'otherError', live: null }

  let p: {
    id: number | string
    variants?: { id: number | string; price: string; available: boolean; barcode?: string | null }[]
  }
  try { p = JSON.parse(res.text) } catch { return { ...base, klass: 'otherError', live: null } }

  const storedPid = row.retailerSku.includes('-') ? row.retailerSku.split('-')[0] : row.retailerSku
  if (String(p.id) !== storedPid) return { ...base, klass: 'productIdMismatch', live: null }

  const variants = p.variants ?? []
  if (variants.length === 0) return { ...base, klass: 'variantMissing', live: null }

  let variant: typeof variants[number] | undefined
  if (row.retailerSku.includes('-')) {
    // Exact stored variant only — never substitute another.
    const vid = row.retailerSku.split('-')[1]
    variant = variants.find(v => String(v.id) === vid)
  } else {
    // Product-level row: the adapter's existing primary rule.
    variant = variants.find(v => v.available) ?? variants[0]
  }
  if (!variant) return { ...base, klass: 'variantMissing', live: null }

  const livePrice = Number(variant.price) / 100
  const live = livePrice.toFixed(2)
  if (!variant.available) return { ...base, klass: 'unavailable', live }
  return {
    ...base,
    klass: Number(live) === Number(stored) ? 'availableUnchanged' : 'availablePriceChanged',
    live,
  }
}

/**
 * The shared price-plausibility guard. True when the new price must be refused
 * outright rather than written.
 */
export function isImplausiblePrice(oldPrice: number, newPrice: number): boolean {
  if (!Number.isFinite(newPrice) || newPrice <= 0) return true
  if (oldPrice <= 0) return false
  return newPrice / oldPrice > MAX_PRICE_RATIO || oldPrice / newPrice > MAX_PRICE_RATIO
}
