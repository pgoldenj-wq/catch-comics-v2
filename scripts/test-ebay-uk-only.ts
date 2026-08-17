/**
 * test-ebay-uk-only.ts — proves Catch Comics can only ever present UK, GBP
 * eBay offers (2026-08-18).
 *
 * Joe reported eBay offers opening USD-priced comics. Three things allowed it:
 *   1. a UK/US region toggle whose 'us' value selected the EBAY_US marketplace;
 *   2. a Browse query with no location filter, so even EBAY_GB returned
 *      overseas sellers who merely ship to the UK (a live probe of
 *      "Absolute Batman" returned a JP-located item);
 *   3. a currency fallback of `|| 'GBP'` that asserted GBP for anything eBay
 *      left unlabelled.
 *
 * These assertions pin the fix at the query boundary. `fetch` is stubbed, so
 * this makes no network calls and costs nothing to run.
 *
 * Run: npm run test:ebay-uk   (no DB, no network)
 */

process.env.EBAY_CLIENT_ID     = process.env.EBAY_CLIENT_ID     || 'test-PRD-id'
process.env.EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET || 'test-secret'

import { searchListings } from '../lib/ebay'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`✓ ${label}`)
  else { failures++; console.error(`✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

// ── fetch stub ───────────────────────────────────────────────────────────────
// Records the Browse request, and replays a fixed result set containing the
// exact shapes that used to leak through.
let lastUrl = ''
let lastHeaders: Record<string, string> = {}

const ITEMS = [
  // Legitimate UK offer — must survive.
  { itemId: 'gb1', title: 'Absolute Batman Vol 1', price: { value: '18.99', currency: 'GBP' },
    condition: 'New', itemWebUrl: 'https://www.ebay.co.uk/itm/gb1', buyingOptions: ['FIXED_PRICE'] },
  // USD listing — the thing Joe saw. Must never reach a customer.
  { itemId: 'us1', title: 'Absolute Batman Vol 1', price: { value: '8.99', currency: 'USD' },
    condition: 'New', itemWebUrl: 'https://www.ebay.com/itm/us1', buyingOptions: ['FIXED_PRICE'] },
  // Missing currency — previously became "GBP" via `|| 'GBP'`.
  { itemId: 'unk', title: 'Absolute Batman Vol 1', price: { value: '4.00' },
    condition: 'New', itemWebUrl: 'https://www.ebay.com/itm/unk', buyingOptions: ['FIXED_PRICE'] },
  // Euro listing — same class of problem as USD.
  { itemId: 'eu1', title: 'Absolute Batman Vol 1', price: { value: '6.50', currency: 'EUR' },
    condition: 'New', itemWebUrl: 'https://www.ebay.de/itm/eu1', buyingOptions: ['FIXED_PRICE'] },
]

global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input.toString()
  if (url.includes('/identity/v1/oauth2/token')) {
    return new Response(JSON.stringify({ access_token: 'stub-token', expires_in: 7200 }), { status: 200 })
  }
  lastUrl = url
  lastHeaders = (init?.headers ?? {}) as Record<string, string>
  return new Response(JSON.stringify({ itemSummaries: ITEMS }), { status: 200 })
}) as typeof fetch

async function main() {
  // Deliberately ask for EBAY_US — a stale ?region=us URL, or any caller that
  // still passes it through, must not be able to reach the US marketplace.
  const listings = await searchListings('Absolute Batman', 'EBAY_US', 20)

  const parsed = new URL(lastUrl)
  const filter = parsed.searchParams.get('filter') || ''

  // ── Query boundary ─────────────────────────────────────────────────────────
  check('marketplace header is EBAY_GB even when EBAY_US is requested',
    lastHeaders['X-EBAY-C-MARKETPLACE-ID'] === 'EBAY_GB',
    `got ${lastHeaders['X-EBAY-C-MARKETPLACE-ID']}`)
  check('query restricts item location to GB',
    filter.includes('itemLocationCountry:GB'), `filter="${filter}"`)
  check('query restricts price currency to GBP',
    filter.includes('priceCurrency:GBP'), `filter="${filter}"`)
  check('comics category still enforced',
    parsed.searchParams.get('category_ids') === '259104')

  // ── Result boundary (defence in depth behind the filter) ───────────────────
  check('USD listing is dropped, not shown',
    !listings.some(l => l.itemId === 'us1'))
  check('EUR listing is dropped, not shown',
    !listings.some(l => l.itemId === 'eu1'))
  check('listing with no currency is dropped, not assumed GBP',
    !listings.some(l => l.itemId === 'unk'))
  check('genuine GBP listing survives',
    listings.some(l => l.itemId === 'gb1'))
  check('every returned offer is GBP',
    listings.every(l => l.price.currency === 'GBP'),
    listings.map(l => l.price.currency).join(','))

  // ── Best-price integrity ───────────────────────────────────────────────────
  // The old code sorted on the raw number, so USD 8.99 and the unlabelled 4.00
  // both beat GBP 18.99 and became the "From £X" hint.
  const cheapest = [...listings].sort((a, b) => a.price.value - b.price.value)[0]
  check('cheapest offer is a real GBP offer, not a smaller foreign number',
    !!cheapest && cheapest.price.currency === 'GBP' && cheapest.itemId === 'gb1',
    cheapest ? `${cheapest.itemId} ${cheapest.price.currency} ${cheapest.price.value}` : 'none')

  // ── Link honesty ───────────────────────────────────────────────────────────
  // wrapEpn used to rewrite any ebay.com host to www.ebay.co.uk, which made a
  // US listing look like a UK one while still sending the customer to US stock.
  const gb = listings.find(l => l.itemId === 'gb1')!
  check('UK item link still points at ebay.co.uk',
    new URL(gb.itemWebUrl).hostname.endsWith('ebay.co.uk'), gb.itemWebUrl)

  console.log('')
  if (failures === 0) console.log('EBAY UK-ONLY: PASS')
  else { console.error(`EBAY UK-ONLY: FAIL — ${failures} problem(s)`); process.exitCode = 1 }
}

main().catch(err => { console.error(err); process.exitCode = 1 })
