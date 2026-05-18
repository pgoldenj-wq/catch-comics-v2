'use client'

/**
 * EbaySection — Marketplace & secondhand listings for a product page.
 *
 * Renders as a clearly separate section BELOW the trusted retailer price
 * comparison table. Never mixed with clean retailer comparison data.
 *
 * Design decisions:
 *   - Client-side fetch so a slow/failed eBay API never blocks page render
 *   - Renders nothing (null) if zero results or fetch fails
 *   - EPN affiliate links go directly (no /go/ — eBay items are ephemeral)
 *   - Click events logged to /api/ebay-click for analytics
 *   - 8 listings max, sorted cheapest first (done server-side)
 *
 * Props:
 *   isbn13             — preferred search key (precise)
 *   title              — fallback / supplementary search term
 *   canonicalProductId — attached to click events for analytics
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
}

interface Props {
  isbn13?:             string | null
  title:               string
  canonicalProductId:  string
}

function fmtPrice(value: number, currency: string) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency', currency, maximumFractionDigits: 2,
  }).format(value)
}

function conditionColor(condition: string): string {
  const c = condition.toLowerCase()
  if (c.includes('new'))              return 'bg-emerald-900/50 text-emerald-300 border-emerald-800'
  if (c.includes('like new') || c.includes('very good'))
                                      return 'bg-teal-900/50   text-teal-300   border-teal-800'
  if (c.includes('good'))             return 'bg-yellow-900/50 text-yellow-300  border-yellow-800'
  if (c.includes('acceptable') || c.includes('fair'))
                                      return 'bg-orange-900/50 text-orange-300  border-orange-800'
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

export default function EbaySection({ isbn13, title, canonicalProductId }: Props) {
  const [listings, setListings] = useState<EbayListing[] | null>(null) // null = loading
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
    // Fire-and-forget click event — never awaited, never blocks navigation
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

  // Don't render if no results or error — section vanishes cleanly
  if (error)                              return null
  if (listings !== null && listings.length === 0) return null

  return (
    <section className="max-w-5xl mx-auto px-4 pb-12">

      {/* Section header */}
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-xl font-semibold text-white">
          Marketplace finds
        </h2>
        {/* eBay brand badge */}
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-[#E8272A]/20 text-[#E8272A] border border-[#E8272A]/30">
          eBay
        </span>
        <span className="text-sm text-gray-500">
          Secondhand & collector prices
        </span>
      </div>

      {/* Loading skeleton */}
      {listings === null && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* Results grid */}
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
                {/* Title */}
                <p className="text-sm font-medium text-gray-200 group-hover:text-white line-clamp-2 mb-2 flex-1">
                  {listing.title}
                </p>

                {/* Condition badge */}
                <span className={`inline-block self-start px-2 py-0.5 rounded text-xs font-medium border mb-3 ${conditionColor(listing.condition)}`}>
                  {listing.condition}
                </span>

                {/* Price */}
                <p className="text-xl font-bold text-[#E8272A] mb-1">
                  {fmtPrice(listing.price.value, listing.price.currency)}
                </p>

                {/* Seller info */}
                <p className="text-xs text-gray-500 mb-3">
                  {listing.seller.username}
                  {listing.seller.feedbackPercentage > 0 && (
                    <span className="ml-1 text-gray-600">
                      ({listing.seller.feedbackPercentage.toFixed(0)}% feedback)
                    </span>
                  )}
                </p>

                {/* CTA */}
                <div className="mt-auto pt-2 border-t border-gray-800">
                  <span className="text-xs font-semibold text-[#E8272A] group-hover:underline">
                    View on eBay ↗
                  </span>
                </div>
              </a>
            ))}
          </div>

          {/* Disclaimer */}
          <p className="mt-3 text-xs text-gray-600">
            Marketplace listings from eBay. Prices, availability and condition vary.
            Catch Comics earns a commission on qualifying purchases.
          </p>
        </>
      )}
    </section>
  )
}
