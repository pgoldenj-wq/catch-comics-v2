'use client'

/**
 * EbaySection — Marketplace price comparison layer.
 *
 * Core principle: CHEAPEST VALID OFFER WINS.
 *
 * If eBay has a cheaper Buy-It-Now price than the best trusted retailer,
 * that is surfaced clearly as a "Best marketplace price" banner — not buried.
 * The user sees it, understands the condition context, and can decide.
 *
 * eBay is always visually distinct (eBay red branding, marketplace labels,
 * condition badges prominent) but is never treated as irrelevant.
 *
 * Props:
 *   isbn13              — preferred eBay search key (ISBN match = high precision)
 *   title               — fallback / supplementary search term
 *   canonicalProductId  — attached to click events for analytics
 *   bestRetailerPrice   — cheapest in-stock trusted retailer price (GBP)
 *   currency            — currency of bestRetailerPrice
 */

import { useEffect, useState, useCallback } from 'react'

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
  isbn13?:             string | null
  title:               string
  canonicalProductId:  string
  bestRetailerPrice?:  number | null   // null = no trusted retailer price known
  currency?:           string
}

function fmtPrice(value: number, currency: string) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency', currency, maximumFractionDigits: 2,
  }).format(value)
}

function conditionColor(condition: string): string {
  const c = condition.toLowerCase()
  if (c.includes('new'))                              return 'bg-emerald-900/50 text-emerald-300 border-emerald-800'
  if (c.includes('like new') || c.includes('very good')) return 'bg-teal-900/50   text-teal-300   border-teal-800'
  if (c.includes('good'))                             return 'bg-yellow-900/50 text-yellow-300  border-yellow-800'
  if (c.includes('acceptable') || c.includes('fair')) return 'bg-orange-900/50 text-orange-300  border-orange-800'
  return 'bg-gray-800 text-gray-400 border-gray-700'
}

function SkeletonCard() {
  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 p-4 animate-pulse">
      <div className="h-3 bg-gray-800 rounded w-3/4 mb-3" />
      <div className="h-3 bg-gray-800 rounded w-1/2 mb-4" />
      <div className="h-6 bg-gray-800 rounded w-1/3 mb-3" />
      <div className="h-8 bg-gray-800 rounded" />
    </div>
  )
}

export default function EbaySection({
  isbn13,
  title,
  canonicalProductId,
  bestRetailerPrice,
}: Props) {
  const [listings, setListings] = useState<EbayListing[] | null>(null)
  const [error,    setError]    = useState(false)

  useEffect(() => {
    const params = new URLSearchParams()
    if (isbn13) params.set('isbn',  isbn13)
    if (title)  params.set('title', title)

    fetch(`/api/ebay?${params.toString()}`)
      .then(r => r.json())
      .then((data: { listings: EbayListing[] }) => setListings(data.listings ?? []))
      .catch(() => { setError(true); setListings([]) })
  }, [isbn13, title])

  const handleClick = useCallback((listing: EbayListing) => {
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
    }).catch(() => { /* ignore */ })
  }, [canonicalProductId])

  if (error)                                       return null
  if (listings !== null && listings.length === 0)  return null

  // Cheapest Buy-It-Now listing — this is the one we compare against retailers.
  // Deliberately no fallback to auctions: the hero banner must only fire for
  // fixed-price listings where the stated price is what the buyer actually pays.
  const cheapestBIN = listings?.find(l => l.buyItNow) ?? null

  // Does eBay beat the best trusted retailer?
  const ebayWins =
    cheapestBIN !== null &&
    typeof bestRetailerPrice === 'number' &&
    bestRetailerPrice > 0 &&
    cheapestBIN.price.value < bestRetailerPrice

  // Does eBay match within 10% (worth surfacing even if not strictly cheapest)?
  const ebayCompetitive =
    cheapestBIN !== null &&
    typeof bestRetailerPrice === 'number' &&
    bestRetailerPrice > 0 &&
    cheapestBIN.price.value < bestRetailerPrice * 1.1

  // Saving calculation deliberately suppressed: eBay prices exclude postage,
  // which is unknown at this point. Claiming "saves £X" without shipping data
  // would be misleading — a £5 item with £4 postage is not cheaper than £8 free delivery.

  return (
    <section className="max-w-5xl mx-auto px-4 pb-10">

      {/* ── Winner banner — shown when eBay beats all trusted retailers ── */}
      {listings !== null && ebayWins && cheapestBIN && (
        <div className="mb-6 rounded-2xl border border-[#E8272A]/40 bg-[#E8272A]/10 p-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-[#E8272A] text-white">
                  eBay
                </span>
                <span className="text-xs font-semibold text-[#E8272A] uppercase tracking-wide">
                  Cheapest found · Marketplace listing
                </span>
              </div>
              <p className="text-3xl font-bold text-white">
                {fmtPrice(cheapestBIN.price.value, cheapestBIN.price.currency)}
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${conditionColor(cheapestBIN.condition)}`}>
                  {cheapestBIN.condition}
                </span>
                <span className="text-sm text-gray-400">
                  from <span className="text-gray-300">{cheapestBIN.seller.username}</span>
                  {cheapestBIN.seller.feedbackPercentage > 0 && (
                    <span className="text-gray-500 ml-1">
                      ({cheapestBIN.seller.feedbackPercentage.toFixed(0)}% feedback)
                    </span>
                  )}
                </span>
                <span className="text-xs text-gray-500">
                  excl. postage — check listing for total
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                {cheapestBIN.buyItNow
                  ? 'Buy It Now — fixed price, buy immediately'
                  : 'Note: auction listing — final price may vary'}
              </p>
            </div>
            <div className="sm:ml-auto">
              <a
                href={cheapestBIN.itemWebUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => handleClick(cheapestBIN)}
                className="inline-block px-6 py-3 rounded-xl bg-[#E8272A] hover:bg-[#c01f22] text-white font-semibold text-base transition-colors"
              >
                View on eBay ↗
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ── Section header ── */}
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-xl font-semibold text-white">
          {ebayWins ? 'All marketplace listings' : 'Marketplace finds'}
        </h2>
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-[#E8272A]/20 text-[#E8272A] border border-[#E8272A]/30">
          eBay
        </span>
        {!ebayWins && ebayCompetitive && cheapestBIN && (
          <span className="text-sm text-gray-500">
            from {fmtPrice(cheapestBIN.price.value, cheapestBIN.price.currency)} — competitive with retailers
          </span>
        )}
        {!ebayWins && !ebayCompetitive && (
          <span className="text-sm text-gray-500">Secondhand &amp; collector prices</span>
        )}
      </div>

      {/* Loading skeleton */}
      {listings === null && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* Listings grid */}
      {listings !== null && listings.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {listings.map(listing => (
              <a
                key={listing.itemId}
                href={listing.itemWebUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => handleClick(listing)}
                className="group flex flex-col rounded-xl bg-gray-900 border border-gray-800 hover:border-[#E8272A]/60 transition-colors p-4"
              >
                {/* Buy It Now badge */}
                {listing.buyItNow && (
                  <span className="self-start mb-2 px-2 py-0.5 rounded text-xs font-semibold bg-gray-800 text-gray-400 border border-gray-700">
                    Buy It Now
                  </span>
                )}
                {!listing.buyItNow && (
                  <span className="self-start mb-2 px-2 py-0.5 rounded text-xs font-semibold bg-amber-900/40 text-amber-400 border border-amber-800/50">
                    Auction
                  </span>
                )}

                {/* Title */}
                <p className="text-sm font-medium text-gray-200 group-hover:text-white line-clamp-2 mb-2 flex-1">
                  {listing.title}
                </p>

                {/* Condition */}
                <span className={`inline-block self-start px-2 py-0.5 rounded text-xs font-medium border mb-3 ${conditionColor(listing.condition)}`}>
                  {listing.condition}
                </span>

                {/* Price */}
                <p className="text-xl font-bold text-[#E8272A] mb-1">
                  {fmtPrice(listing.price.value, listing.price.currency)}
                </p>

                {/* Seller */}
                <p className="text-xs text-gray-500 mb-3">
                  {listing.seller.username}
                  {listing.seller.feedbackPercentage > 0 && (
                    <span className="ml-1 text-gray-600">
                      ({listing.seller.feedbackPercentage.toFixed(0)}% feedback)
                    </span>
                  )}
                </p>

                <div className="mt-auto pt-2 border-t border-gray-800">
                  <span className="text-xs font-semibold text-[#E8272A] group-hover:underline">
                    View on eBay ↗
                  </span>
                </div>
              </a>
            ))}
          </div>

          <p className="mt-3 text-xs text-gray-600">
            Marketplace listings from eBay. Prices, availability and condition vary by seller.
            Catch Comics earns a commission on qualifying purchases.
          </p>
        </>
      )}
    </section>
  )
}
