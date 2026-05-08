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

export type Marketplace = 'EBAY_GB' | 'EBAY_US'

export interface EbayListing {
  itemId:     string
  title:      string
  price:      { value: number; currency: string }
  condition:  string
  imageUrl:   string
  itemWebUrl: string
  seller:     { username: string; feedbackPercentage: number }
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
  itemId?:     string
  title?:      string
  price?:      { value?: string; currency?: string }
  condition?:  string
  image?:      { imageUrl?: string }
  itemWebUrl?: string
  seller?:     { username?: string; feedbackPercentage?: string }
}

export async function searchListings(
  query: string,
  marketplace: Marketplace,
  limit = 20,
): Promise<EbayListing[]> {
  if (!query.trim()) return []

  const token          = await getAccessToken()
  const enrichedQuery  = enrichEbayQuery(query)
  const url            = new URL(`${apiBase()}/buy/browse/v1/item_summary/search`)
  url.searchParams.set('q',            enrichedQuery)
  url.searchParams.set('limit',        String(limit))
  // Restrict to Comics & Graphic Novels category (259104) to prevent non-comic
  // products (e.g. household cleaners for "Bleach", costumes for "Batman") from
  // appearing in results. This category covers singles, TPBs, omnibuses and manga
  // on both EBAY_GB and EBAY_US.
  url.searchParams.set('category_ids', '259104')

  const res = await fetch(url.toString(), {
    headers: {
      'Authorization':           `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': marketplace,
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

function isFCBD(title: string): boolean {
  const t = title.toLowerCase()
  return t.includes('free comic book day') || t.includes('fcbd')
}

function mapListing(r: RawBrowseItem): EbayListing | null {
  if (!r.itemId || !r.title || !r.price?.value) return null
  if (isFCBD(r.title)) return null
  if (isNonComicListing(r.title)) return null
  return {
    itemId:     r.itemId,
    title:      r.title,
    price:      {
      value:    parseFloat(r.price.value),
      currency: r.price.currency || 'USD',
    },
    condition:  r.condition || 'Unspecified',
    imageUrl:   r.image?.imageUrl    || '',
    itemWebUrl: r.itemWebUrl         || '',
    seller:     {
      username:           r.seller?.username || '',
      feedbackPercentage: parseFloat(r.seller?.feedbackPercentage || '0'),
    },
  }
}

// ── Query builder ─────────────────────────────────────────────────────────────
// The display name on Catch Comics already encodes useful structure
// ("Absolute Batman #19", "Saga Vol 1") so we use it as-is. Caller can
// override with a custom string if needed.

export function buildQuery(comic: { name: string }): string {
  return (comic.name || '').trim()
}
