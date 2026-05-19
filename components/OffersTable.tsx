'use client'

/**
 * OffersTable — client component.
 *
 * Renders the price comparison table with "New / Used / All" tab switching.
 *
 * Trusted-retailer rows link through /go/{listingId} for click tracking +
 * affiliate redirect. eBay Buy-It-Now rows are merged inline as marketplace
 * rows — fetched client-side from /api/ebay, shown with a marketplace badge,
 * direct external link, and a postage disclaimer.
 *
 * If eBay is unavailable the table degrades gracefully (retailer rows only).
 * While eBay is loading a subtle status line is shown below the table.
 */

import { useState, useEffect, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OfferRow {
  listingId:          string
  retailerName:       string
  retailerUrl:        string   // raw URL — trusted retailer rows never use this directly
  condition:          string
  conditionDetail:    string | null
  priceAmount:        number
  currency:           string
  shippingAmount:     number | null
  stockStatus:        string
  lastSeenAt:         string   // ISO string
  trustScore:         number
  // ── Marketplace extension (eBay BIN rows) ──────────────────────────────────
  isMarketplace?:     boolean
  marketplaceLabel?:  string   // e.g. "eBay"
  marketplaceSeller?: string
  externalUrl?:       string   // direct external link (bypasses /go/)
}

interface EbayListing {
  itemId:     string
  title:      string
  price:      { value: number; currency: string }
  condition:  string
  imageUrl:   string
  itemWebUrl: string
  seller:     { username: string; feedbackPercentage: number }
  buyItNow:   boolean
}

interface Props {
  offers:              OfferRow[]
  isbn13?:             string | null
  productTitle?:       string
  canonicalProductId?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

type Tab = 'ALL' | 'NEW' | 'USED'

const CONDITION_LABELS: Record<string, string> = {
  NEW:        'New',
  LIKE_NEW:   'Like New',
  VERY_GOOD:  'Very Good',
  GOOD:       'Good',
  ACCEPTABLE: 'Acceptable',
  POOR:       'Poor',
  GRADED:     'Graded',
  UNGRADED:   'Ungraded',
}

const STOCK_LABELS: Record<string, { label: string; cls: string }> = {
  IN_STOCK:    { label: 'In stock',  cls: 'text-emerald-600' },
  LOW_STOCK:   { label: 'Low stock', cls: 'text-amber-600'   },
  PREORDER:    { label: 'Pre-order', cls: 'text-sky-600'      },
  OUT_OF_STOCK:{ label: 'OOS',       cls: 'text-red-500'      },
  UNKNOWN:     { label: 'Unknown',   cls: 'text-gray-400'     },
}

const STALE_DAYS = 30

// ── Helpers ───────────────────────────────────────────────────────────────────

function isStale(lastSeenAt: string): boolean {
  const age = Date.now() - new Date(lastSeenAt).getTime()
  return age > STALE_DAYS * 24 * 60 * 60 * 1000
}

function fmtPrice(amount: number, currency: string) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency', currency, maximumFractionDigits: 2,
  }).format(amount)
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

// eBay condition strings use natural-language labels — map to new/used buckets.
// "New" → new. Everything else → used.
function ebayConditionIsNew(condition: string): boolean {
  return condition.toLowerCase() === 'new'
}

// Determine whether an OfferRow falls into the NEW or USED tab bucket.
function isNewRow(o: OfferRow): boolean {
  if (o.isMarketplace) return ebayConditionIsNew(o.condition)
  return o.condition === 'NEW'
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function OffersTable({ offers, isbn13, productTitle, canonicalProductId }: Props) {
  const [tab,          setTab]          = useState<Tab>('ALL')
  const [ebayListings, setEbayListings] = useState<EbayListing[] | null>(null)
  const [ebayError,    setEbayError]    = useState(false)

  // ── Fetch eBay BIN listings ────────────────────────────────────────────────
  useEffect(() => {
    if (!isbn13 && !productTitle) return
    const params = new URLSearchParams()
    if (isbn13)       params.set('isbn',  isbn13)
    if (productTitle) params.set('title', productTitle)

    fetch(`/api/ebay?${params.toString()}`)
      .then(r => r.json())
      .then((data: { listings: EbayListing[] }) => setEbayListings(data.listings ?? []))
      .catch(() => { setEbayError(true); setEbayListings([]) })
  }, [isbn13, productTitle])

  // ── eBay click tracker ────────────────────────────────────────────────────
  const handleEbayClick = useCallback((listing: EbayListing) => {
    fetch('/api/ebay-click', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        itemId:             listing.itemId,
        canonicalProductId,
        title:              listing.title,
        price:              listing.price.value,
        currency:           listing.price.currency,
        condition:          listing.condition,
      }),
    }).catch(() => {})
  }, [canonicalProductId])

  // ── Convert eBay BIN listings → OfferRow ─────────────────────────────────
  const ebayRows: OfferRow[] = (ebayListings ?? [])
    .filter(l => l.buyItNow)
    .map(l => ({
      listingId:          l.itemId,
      retailerName:       'eBay',
      retailerUrl:        l.itemWebUrl,
      condition:          l.condition,
      conditionDetail:    l.seller.feedbackPercentage > 0
                            ? `${l.seller.username} · ${l.seller.feedbackPercentage.toFixed(0)}% feedback`
                            : l.seller.username,
      priceAmount:        l.price.value,
      currency:           l.price.currency,
      shippingAmount:     null,       // unknown — shown as "excl. postage"
      stockStatus:        'IN_STOCK', // BIN = available immediately
      lastSeenAt:         new Date().toISOString(),
      trustScore:         0,
      isMarketplace:      true,
      marketplaceLabel:   'eBay',
      marketplaceSeller:  l.seller.username,
      externalUrl:        l.itemWebUrl,
    }))

  // ── Merge + sort by price ─────────────────────────────────────────────────
  // Note: eBay prices exclude postage so this is not a perfect apples-to-apples
  // sort — but it's the same signal every comparison site uses and the postage
  // caveat is shown on every marketplace row.
  const merged: OfferRow[] = [...offers, ...ebayRows]
    .sort((a, b) => a.priceAmount - b.priceAmount)

  // ── Tab filtering ─────────────────────────────────────────────────────────
  const visible = merged.filter(o => {
    if (tab === 'NEW')  return  isNewRow(o)
    if (tab === 'USED') return !isNewRow(o)
    return true
  })

  const newCount   = merged.filter(o =>  isNewRow(o)).length
  const usedCount  = merged.filter(o => !isNewRow(o)).length
  const totalCount = merged.length

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'ALL',  label: 'All',  count: totalCount },
    { id: 'NEW',  label: 'New',  count: newCount   },
    { id: 'USED', label: 'Used', count: usedCount  },
  ]

  const ebayLoading = (isbn13 || productTitle) && ebayListings === null && !ebayError

  return (
    <div>
      {/* Tabs */}
      <div className="flex gap-1 mb-4">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              tab === t.id
                ? 'bg-[#E8272A] text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900'
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-xs opacity-70">({t.count})</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="text-gray-500 text-sm py-4">No {tab.toLowerCase()} listings available.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase tracking-wide border-b border-gray-200">
                <th className="pb-2 pr-4 font-medium">Retailer</th>
                <th className="pb-2 pr-4 font-medium">Condition</th>
                <th className="pb-2 pr-4 font-medium">Price</th>
                <th className="pb-2 pr-4 font-medium hidden sm:table-cell">Shipping</th>
                <th className="pb-2 pr-4 font-medium hidden md:table-cell">Stock</th>
                <th className="pb-2 pr-4 font-medium hidden lg:table-cell">Last checked</th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((o, i) => {
                const stale = !o.isMarketplace && isStale(o.lastSeenAt)
                const stock = STOCK_LABELS[o.stockStatus] ?? STOCK_LABELS['UNKNOWN']

                // "Best price" badge: only for trusted retailers (marketplace postage is unknown)
                const isBest = i === 0 && visible.length > 1 && !o.isMarketplace

                // Link destination: marketplace rows use externalUrl directly;
                // trusted retailer rows go through /go/ for click tracking + affiliate redirect.
                const href = o.isMarketplace ? (o.externalUrl ?? '#') : `/go/${o.listingId}`

                return (
                  <tr
                    key={`${o.isMarketplace ? 'mp' : 'rl'}-${o.listingId}`}
                    className={`hover:bg-gray-50 transition-colors ${stale ? 'opacity-50' : ''} ${o.isMarketplace ? 'bg-amber-50/30' : ''}`}
                  >
                    {/* Retailer / marketplace name */}
                    <td className="py-3 pr-4 font-medium text-gray-900">
                      <span className="flex items-center gap-2 flex-wrap">
                        {o.retailerName}
                        {o.isMarketplace && o.marketplaceLabel && (
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#E8272A] text-white leading-none">
                            {o.marketplaceLabel}
                          </span>
                        )}
                        {isBest && (
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-600 text-white leading-none">
                            Best price
                          </span>
                        )}
                      </span>
                      {stale && (
                        <span className="text-xs text-amber-600 font-normal">(stale)</span>
                      )}
                    </td>

                    {/* Condition */}
                    <td className="py-3 pr-4 text-gray-700">
                      {o.isMarketplace
                        ? o.condition
                        : (CONDITION_LABELS[o.condition] ?? o.condition)}
                      {o.conditionDetail && (
                        <span className="block text-xs text-gray-400">{o.conditionDetail}</span>
                      )}
                    </td>

                    {/* Price */}
                    <td className="py-3 pr-4">
                      <span className="font-semibold text-gray-900">
                        {fmtPrice(o.priceAmount, o.currency)}
                      </span>
                      {!o.isMarketplace && o.shippingAmount !== null && o.shippingAmount > 0 && (
                        <span className="block text-xs text-gray-400">
                          +{fmtPrice(o.shippingAmount, o.currency)} ship
                        </span>
                      )}
                      {!o.isMarketplace && o.shippingAmount === 0 && (
                        <span className="block text-xs text-emerald-600">Free shipping</span>
                      )}
                      {o.isMarketplace && (
                        <span className="block text-xs text-amber-600">excl. postage</span>
                      )}
                    </td>

                    {/* Shipping column (sm+) */}
                    <td className="py-3 pr-4 hidden sm:table-cell text-gray-500">
                      {o.isMarketplace
                        ? <span className="text-amber-600 text-xs">excl. postage</span>
                        : o.shippingAmount === null
                          ? '—'
                          : o.shippingAmount === 0
                            ? 'Free'
                            : fmtPrice(o.shippingAmount, o.currency)}
                    </td>

                    {/* Stock (md+) */}
                    <td className={`py-3 pr-4 hidden md:table-cell font-medium ${stock.cls}`}>
                      {o.isMarketplace ? (
                        <span className="text-emerald-600">Available</span>
                      ) : (
                        stock.label
                      )}
                    </td>

                    {/* Last checked (lg+) */}
                    <td className="py-3 pr-4 hidden lg:table-cell text-gray-400 text-xs">
                      {o.isMarketplace ? 'Live' : fmtDate(o.lastSeenAt)}
                    </td>

                    {/* CTA */}
                    <td className="py-3 text-right">
                      {o.isMarketplace ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => {
                            // Find the original EbayListing to pass to the click handler.
                            // We reconstruct a minimal object from the OfferRow fields.
                            const fakeEbayListing: EbayListing = {
                              itemId:     o.listingId,
                              title:      o.conditionDetail ?? '',
                              price:      { value: o.priceAmount, currency: o.currency },
                              condition:  o.condition,
                              imageUrl:   '',
                              itemWebUrl: o.externalUrl ?? '',
                              seller:     { username: o.marketplaceSeller ?? '', feedbackPercentage: 0 },
                              buyItNow:   true,
                            }
                            handleEbayClick(fakeEbayListing)
                          }}
                          className="inline-block px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors bg-[#E8272A] text-white hover:bg-[#c41f22]"
                        >
                          View on eBay ↗
                        </a>
                      ) : (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`inline-block px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                            stale
                              ? 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                              : 'bg-[#E8272A] text-white hover:bg-[#c41f22]'
                          }`}
                        >
                          Buy at {o.retailerName} ↗
                        </a>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Marketplace loading / footnote */}
      {ebayLoading && (
        <p className="mt-3 text-xs text-gray-400 animate-pulse">
          Loading marketplace prices…
        </p>
      )}
      {!ebayLoading && ebayRows.length > 0 && (
        <p className="mt-3 text-xs text-gray-500">
          <span className="font-semibold text-[#E8272A]">eBay</span> marketplace listings shown with eBay branding.
          Prices exclude postage — check listing for full cost.
          Catch Comics earns a commission on qualifying eBay purchases.
        </p>
      )}
    </div>
  )
}
