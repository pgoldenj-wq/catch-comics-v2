'use client'

import { useEffect, useState } from 'react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Listing {
  itemId:     string
  title:      string
  price:      { value: number; currency: string }
  condition:  string
  imageUrl:   string
  itemWebUrl: string
  seller:     { username: string; feedbackPercentage: number }
}

interface PricesResponse {
  query?:       string
  region?:      string
  marketplace?: string
  source?:      string
  count?:       number
  listings?:    Listing[]
  error?:       string
  detail?:      string
}

interface PricingPanelProps {
  query:  string
  region: 'uk' | 'us'
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: '£',
  USD: '$',
  EUR: '€',
}

function formatPrice(value: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency] || `${currency} `
  return `${symbol}${value.toFixed(2)}`
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Live pricing panel — calls /api/prices on the server, which proxies the
 * eBay Buy Browse API (auto-detects sandbox vs production from the configured
 * App ID). Listings are sorted cheapest-first server-side; we re-sort defensively.
 *
 * States:
 *   - loading           → skeleton rows
 *   - error             → text card
 *   - empty (sandbox)   → "production pricing will appear once approved"
 *   - has results       → card list with "Best" badge on the cheapest
 */
export default function PricingPanel({ query, region }: PricingPanelProps) {
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [listings, setListings] = useState<Listing[]>([])

  useEffect(() => {
    if (!query) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    setListings([])

    const controller = new AbortController()
    fetch(`/api/prices?q=${encodeURIComponent(query)}&region=${region}`, { signal: controller.signal })
      .then(res => res.json())
      .then((data: PricesResponse) => {
        if (data.error) {
          setError(data.error)
          setListings([])
        } else {
          // Defensive client-side sort — cheapest first
          const sorted = [...(data.listings || [])].sort((a, b) => a.price.value - b.price.value)
          setListings(sorted)
        }
        setLoading(false)
      })
      .catch(err => {
        if (err instanceof Error && err.name === 'AbortError') return
        setError('Could not load listings.')
        setLoading(false)
      })

    return () => controller.abort()
  }, [query, region])

  const regionLabel = region === 'uk' ? 'United Kingdom' : 'United States'

  return (
    <div>
      {/* Header — matches the existing offers strip on the comic detail page */}
      <p className="text-xs text-gray-400 mb-4 uppercase tracking-wide">
        {loading
          ? 'Loading offers…'
          : `${listings.length} ${listings.length === 1 ? 'offer' : 'offers'} · ${regionLabel}`}
      </p>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3" role="status" aria-label="Loading listings">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="animate-pulse flex items-center gap-4 p-4 rounded-2xl border border-gray-100 bg-white"
            >
              <div className="w-14 h-14 rounded-md bg-gray-100 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-100 rounded w-2/3" />
                <div className="h-3 bg-gray-100 rounded w-1/3" />
              </div>
              <div className="h-8 w-24 rounded-xl bg-gray-100 shrink-0" />
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center">
          <p className="text-sm text-gray-500">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && listings.length === 0 && (
        <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center">
          <p className="text-sm text-gray-500">
            No listings found for this title right now. Check back soon.
          </p>
        </div>
      )}

      {/* Listings */}
      {!loading && !error && listings.length > 0 && (
        <ul className="space-y-3">
          {listings.map((l, i) => {
            const isBest    = i === 0
            const feedback  = l.seller.feedbackPercentage > 0 ? `${l.seller.feedbackPercentage}% feedback` : ''
            const meta      = ['eBay', l.condition || 'Unspecified', l.seller.username, feedback].filter(Boolean).join(' · ')

            return (
              <li
                key={l.itemId}
                className="flex items-center gap-4 p-4 rounded-2xl bg-white transition-all"
                style={{ border: isBest ? '2px solid #E8272A' : '1px solid #F3F4F6' }}
              >
                {/* Cover thumbnail — letter fallback hidden behind the image */}
                <div className="relative w-14 h-14 rounded-md overflow-hidden bg-gray-100 border border-gray-200 shrink-0 flex items-center justify-center">
                  <span className="absolute text-gray-300 text-base font-medium" aria-hidden="true">
                    {(l.title.charAt(0) || '?').toUpperCase()}
                  </span>
                  {l.imageUrl && (
                    <img
                      src={l.imageUrl}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover"
                      loading="lazy"
                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                    />
                  )}
                </div>

                {/* Title + meta */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {isBest && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide bg-[#E8272A] text-white px-2 py-0.5 rounded-md shrink-0">
                        Best
                      </span>
                    )}
                    <p className="text-sm font-semibold text-gray-900 truncate" title={l.title}>
                      {l.title}
                    </p>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 truncate" title={meta}>
                    {meta}
                  </p>
                </div>

                {/* Price */}
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold text-gray-900 whitespace-nowrap">
                    {formatPrice(l.price.value, l.price.currency)}
                  </div>
                </div>

                {/* CTA — opens eBay listing in a new tab */}
                <a
                  href={l.itemWebUrl || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 px-4 py-2 text-white text-xs font-semibold rounded-xl transition-colors"
                  style={{ background: '#0A0A0A' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#E8272A')}
                  onMouseLeave={e => (e.currentTarget.style.background = '#0A0A0A')}
                  aria-label={`View listing on eBay: ${l.title}`}
                >
                  View listing →
                </a>
              </li>
            )
          })}
        </ul>
      )}

      {/* ── Also search on… ───────────────────────────────────────────────────
          Static affiliate search links — no price data. Always shown once
          loading is done (regardless of eBay result count). */}
      {!loading && (
        <div className="mt-4 space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-2">Also search on</p>

          {/* Amazon */}
          <a
            href={`https://www.amazon.com/s?k=${encodeURIComponent(query + ' comic')}&tag=catchcomics-20`}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="flex items-center gap-3 p-3 rounded-xl bg-white border border-gray-100 hover:border-gray-300 transition-colors group"
            aria-label={`Search for ${query} on Amazon`}
          >
            {/* Amazon logo mark */}
            <div className="w-8 h-8 rounded-md bg-[#FF9900] flex items-center justify-center shrink-0 text-white font-bold text-xs">
              a
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800">Amazon</p>
              <p className="text-xs text-gray-400">Search for this title</p>
            </div>
            <span className="text-xs text-gray-400 group-hover:text-gray-600 shrink-0">Search →</span>
          </a>

          {/* AbeBooks */}
          <a
            href={`https://www.abebooks.com/servlet/SearchResults?kn=${encodeURIComponent(query)}&tn=&cm_sp=mbc-_-abb-_-used`}
            target="_blank"
            rel="noopener noreferrer sponsored"
            className="flex items-center gap-3 p-3 rounded-xl bg-white border border-gray-100 hover:border-gray-300 transition-colors group"
            aria-label={`Search for ${query} on AbeBooks`}
          >
            {/* AbeBooks logo mark */}
            <div className="w-8 h-8 rounded-md bg-[#C41F22] flex items-center justify-center shrink-0 text-white font-bold text-xs">
              A
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800">AbeBooks</p>
              <p className="text-xs text-gray-400">New, used &amp; collectible</p>
            </div>
            <span className="text-xs text-gray-400 group-hover:text-gray-600 shrink-0">Search →</span>
          </a>
        </div>
      )}
    </div>
  )
}
