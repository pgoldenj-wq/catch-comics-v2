/**
 * eBay Buy Browse API — server-side integration.
 *
 * Auto-detects sandbox vs production from the Client ID prefix
 * (-SBX- → sandbox, -PRD- → production). No code change required to switch
 * environments — just swap the keys in .env.local / Vercel.
 *
 * Security: SERVER-ONLY. This module reads EBAY_CLIENT_ID and EBAY_CLIENT_SECRET
 * from process.env. Never import it from a client component. (Env vars
 * without NEXT_PUBLIC_ resolve to undefined client-side anyway, so a stray
 * import would fail silently with empty creds.)
 */

import { enrichEbayQuery, isNonComicListing } from '@/lib/comicDisambiguation'

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Catch Comics is a UK price-comparison site, so EBAY_GB is the only
 * marketplace we ever query. The type is kept as a union because call sites
 * still pass a marketplace through from a `region` param, but searchListings()
 * pins the request to EBAY_GB regardless — see UK_ONLY below.
 */
export type Marketplace = 'EBAY_GB' | 'EBAY_US'

/**
 * UK-only enforcement, applied at the query boundary rather than in the UI.
 *
 * Three separate things went wrong before this existed:
 *
 *  1. `region=us` (a US toggle on /search, and an unvalidated URL param)
 *     switched the whole eBay path to EBAY_US, so a UK shopper was shown
 *     USD-priced US listings as if they were Catch Comics offers.
 *  2. The Browse request carried no location filter, so even on EBAY_GB the
 *     results included overseas inventory that merely ships to the UK — a
 *     live probe of "Absolute Batman" returned a JP-located item.
 *  3. Best-price code sorts on `price.value` as a bare number, so a $8.99 US
 *     listing outranked a £10.99 UK one and became the "From £X" hint.
 *
 * Filtering here fixes all four call sites at once (product offers, price
 * hints, /api/prices and search) and keeps non-GBP out of the data entirely,
 * rather than hiding a USD figure behind a £ sign in the UI.
 */
const UK_MARKETPLACE: Marketplace = 'EBAY_GB'
const UK_FILTER = 'itemLocationCountry:GB,priceCurrency:GBP'

export interface EbayListing {
  itemId:      string
  title:       string
  price:       { value: number; currency: string }
  condition:   string
  imageUrl:    string
  itemWebUrl:  string
  seller:      { username: string; feedbackPercentage: number }
  /** True when listing is Buy It Now / Fixed Price (not an auction). */
  buyItNow:    boolean
}

// ── Environment detection ─────────────────────────────────────────────────────

function isProduction(): boolean {
  // eBay Client IDs contain -SBX- or -PRD-. Default to production so real
  // listings are returned when keys do not include an environment marker.
  return !/-SBX-/.test(process.env.EBAY_CLIENT_ID || '')
}

function apiBase(): string {
  return isProduction()
    ? 'https://api.ebay.com'
    : 'https://api.sandbox.ebay.com'
}

// ── OAuth token cache ─────────────────────────────────────────────────────────
// Per-process in-memory cache. Token TTL is ~7200s; we refresh 5 min early.

interface CachedToken {
  token:     string
  expiresAt: number
}

let cachedToken: CachedToken | null = null

export async function getAccessToken(): Promise<string> {
  const now = Date.now()
  if (cachedToken && cachedToken.expiresAt > now + 5 * 60 * 1000) {
    return cachedToken.token
  }

  const clientId     = (process.env.EBAY_CLIENT_ID     || '').trim()
  const clientSecret = (process.env.EBAY_CLIENT_SECRET || '').trim()
  if (!clientId || !clientSecret) {
    throw new Error(
      `eBay credentials missing — set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET ` +
      `(id length: ${clientId.length}, secret length: ${clientSecret.length})`
    )
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const url  = `${apiBase()}/identity/v1/oauth2/token`
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope:      'https://api.ebay.com/oauth/api_scope',
  })

  const res = await fetch(url, {
    method:  'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type':  'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })

  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`eBay OAuth failed: ${res.status} ${errorText}`)
  }

  const data = await res.json() as { access_token: string; expires_in: number }
  cachedToken = {
    token:     data.access_token,
    expiresAt: now + data.expires_in * 1000,
  }
  console.log(`[ebay] new token issued (${isProduction() ? 'prod' : 'sandbox'}, expires in ${data.expires_in}s)`)
  return data.access_token
}

// ── Browse API search ─────────────────────────────────────────────────────────

interface RawBrowseItem {
  itemId?:        string
  title?:         string
  price?:         { value?: string; currency?: string }
  condition?:     string
  image?:         { imageUrl?: string }
  itemWebUrl?:    string
  seller?:        { username?: string; feedbackPercentage?: string }
  /** e.g. ["FIXED_PRICE"], ["BEST_OFFER"], ["AUCTION"] */
  buyingOptions?: string[]
}

export async function searchListings(
  query: string,
  // Accepted for call-site compatibility but deliberately ignored: every
  // request is pinned to EBAY_GB. See UK_MARKETPLACE above.
  _marketplace: Marketplace,
  limit = 20,
): Promise<EbayListing[]> {
  if (!query.trim()) return []

  const token          = await getAccessToken()
  const enrichedQuery  = enrichEbayQuery(query)
  const url            = new URL(`${apiBase()}/buy/browse/v1/item_summary/search`)
  url.searchParams.set('q',            enrichedQuery)
  url.searchParams.set('limit',        String(limit))
  // UK inventory, priced in GBP. Without this, EBAY_GB still returns overseas
  // sellers who ship to the UK.
  url.searchParams.set('filter',       UK_FILTER)
  // Restrict to Comics & Graphic Novels category (259104) to prevent non-comic
  // products (e.g. household cleaners for "Bleach", costumes for "Batman") from
  // appearing in results. This category covers singles, TPBs, omnibuses and manga
  // on both EBAY_GB and EBAY_US.
  url.searchParams.set('category_ids', '259104')

  const res = await fetch(url.toString(), {
    headers: {
      'Authorization':           `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': UK_MARKETPLACE,
      'Accept':                  'application/json',
    },
  })

  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`eBay Browse API failed: ${res.status} ${errorText}`)
  }

  const data  = await res.json() as { itemSummaries?: RawBrowseItem[] }
  const items = data.itemSummaries || []
  return items
    .map(mapListing)
    .filter((x): x is EbayListing => x !== null)
}

// ── EPN affiliate wrapping ────────────────────────────────────────────────────
// Set EBAY_CAMPAIGN_ID to your eBay Partner Network campaign ID.
// When set, all item URLs are wrapped with EPN tracking parameters so
// qualifying purchases earn affiliate commission.
// Find your campaign ID at: https://partnernetwork.ebay.com/

const EBAY_CAMPAIGN_ID = (process.env.EBAY_CAMPAIGN_ID || '').trim()
const EBAY_TOOL_ID     = '10001'  // standard eBay deep-link tool

function wrapEpn(url: string): string {
  if (!EBAY_CAMPAIGN_ID || !url) return url
  try {
    const u = new URL(url)
    // The previous version rewrote any ebay.com host to www.ebay.co.uk on the
    // theory that item ids are global. That made a US listing *look* like a UK
    // one in the link while it stayed a US listing underneath — the customer
    // still landed on overseas stock, and a rewritten host can miss entirely.
    // Disguising the destination is the opposite of the fix; UK_FILTER now
    // keeps non-GB inventory out of the results, so there is nothing to
    // normalise and the real destination is left intact.
    u.searchParams.set('campid',  EBAY_CAMPAIGN_ID)
    u.searchParams.set('toolid',  EBAY_TOOL_ID)
    u.searchParams.set('mkevt',   '1')   // event type: click
    u.searchParams.set('mkcid',   '1')   // channel: EPN
    return u.toString()
  } catch {
    return url  // malformed URL — return unchanged
  }
}

function isFCBD(title: string): boolean {
  const t = title.toLowerCase()
  return t.includes('free comic book day') || t.includes('fcbd')
}

const BROKEN_CONDITIONS = new Set([
  'for parts or not working',
  'parts only',
  'not working',
])

function isBrokenCondition(condition: string): boolean {
  return BROKEN_CONDITIONS.has(condition.toLowerCase())
}

function mapListing(r: RawBrowseItem): EbayListing | null {
  if (!r.itemId || !r.title || !r.price?.value) return null
  if (isFCBD(r.title)) return null
  if (isNonComicListing(r.title)) return null
  if (isBrokenCondition(r.condition || '')) return null

  // Defence in depth behind UK_FILTER. Previously the currency fell back to
  // `|| 'GBP'`, which asserted GBP for anything eBay left unlabelled — the one
  // way a non-GBP amount could still reach a customer wearing a £ sign. An
  // offer we cannot prove is in GBP is dropped rather than guessed, matching
  // the rule that uncertain data is omitted rather than presented.
  if (r.price.currency !== 'GBP') return null

  const buyingOptions = r.buyingOptions ?? []
  const buyItNow      = buyingOptions.includes('FIXED_PRICE') || buyingOptions.includes('BEST_OFFER')

  return {
    itemId:     r.itemId,
    title:      r.title,
    price:      {
      value:    parseFloat(r.price.value),
      currency: r.price.currency,
    },
    condition:  r.condition || 'Unspecified',
    imageUrl:   r.image?.imageUrl    || '',
    itemWebUrl: wrapEpn(r.itemWebUrl  || ''),
    seller:     {
      username:           r.seller?.username || '',
      feedbackPercentage: parseFloat(r.seller?.feedbackPercentage || '0'),
    },
    buyItNow,
  }
}

// ── Query builder ─────────────────────────────────────────────────────────────
// The display name on Catch Comics already encodes useful structure
// ("Absolute Batman #19", "Saga Vol 1") so we use it as-is. Caller can
// override with a custom string if needed.

export function buildQuery(comic: { name: string }): string {
  return (comic.name || '').trim()
}
