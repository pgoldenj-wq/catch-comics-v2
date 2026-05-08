'use client'

import { useEffect, useState, useMemo } from 'react'
import { buildAmazonUrl, type ComicFormat } from '@/lib/amazon'
import { buildAbeBooksUrl } from '@/lib/abebooks'
import { buildForbiddenPlanetSearchUrl } from '@/lib/forbiddenplanet'

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

/**
 * Summary of all unfiltered eBay listings for a query — passed to the parent
 * via onPriceSnapshot so the hero intelligence panel can display live stats
 * without fetching independently.
 */
export interface PriceSnapshot {
  bestPrice:      number
  worstPrice:     number
  totalOffers:    number
  newFrom:        number | null   // cheapest New-condition listing, or null
  usedFrom:       number | null   // cheapest Used-condition listing, or null
  currency:       string
  bestListingUrl: string
}

interface PricingPanelProps {
  query:        string
  region:       'uk' | 'us'
  /** Client-side format filter applied to eBay listings ('all' = no filter) */
  formatFilter?: 'all' | 'graphic-novel' | 'single-issue' | 'manga'
  /** Called when the user clicks a format pill. When provided, pills are rendered in the panel header. */
  onFormatChange?: (f: 'all' | 'graphic-novel' | 'single-issue' | 'manga') => void
  /** Client-side max-price filter applied to eBay listings ('all' = no filter) */
  priceMax?:    'all' | '5' | '10' | '15' | '25' | '35' | '50'
  /** Client-side condition filter ('all' = no filter) */
  condition?:   'all' | 'new' | 'used'
  /**
   * Called once listings are loaded (or confirmed empty).
   * Receives a PriceSnapshot with summary stats for the hero intelligence panel,
   * or null if no listings were found.
   */
  onPriceSnapshot?: (snapshot: PriceSnapshot | null) => void
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
 * eBay Buy Browse API. Listings are sorted cheapest-first server-side; we
 * re-sort defensively, then optionally filter client-side by format/priceMax.
 */
export default function PricingPanel({ query, region, formatFilter = 'all', onFormatChange, priceMax = 'all', condition = 'all', onPriceSnapshot }: PricingPanelProps) {
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
          onPriceSnapshot?.(null)
        } else {
          // Defensive client-side sort — cheapest first
          const sorted = [...(data.listings || [])].sort((a, b) => a.price.value - b.price.value)
          setListings(sorted)

          // Compute snapshot for hero intelligence panel
          if (sorted.length === 0) {
            onPriceSnapshot?.(null)
          } else {
            const newFrom  = sorted.find(l => l.condition.toLowerCase() === 'new')?.price.value ?? null
            const usedFrom = sorted.find(l => {
              const c = l.condition.toLowerCase()
              return c !== 'new' && c !== '' && c !== 'unspecified'
            })?.price.value ?? null
            onPriceSnapshot?.({
              bestPrice:      sorted[0].price.value,
              worstPrice:     sorted[sorted.length - 1].price.value,
              totalOffers:    sorted.length,
              newFrom,
              usedFrom,
              currency:       sorted[0].price.currency,
              bestListingUrl: sorted[0].itemWebUrl,
            })
          }
        }
        setLoading(false)
      })
      .catch(err => {
        if (err instanceof Error && err.name === 'AbortError') return
        setError('Could not load listings.')
        onPriceSnapshot?.(null)
        setLoading(false)
      })

    return () => controller.abort()
  }, [query, region])

  // Client-side filter applied on top of the server-sorted listings
  const visibleListings = useMemo(() => {
    let ls = [...listings]

    if (formatFilter !== 'all') {
      ls = ls.filter(l => {
        const t = l.title.toLowerCase()
        switch (formatFilter) {
          case 'single-issue':
            return /#\d/.test(t) || t.includes('issue') || t.includes('single')
          case 'graphic-novel':
            return (
              /\bvol(ume)?\b/.test(t) || t.includes('tpb') || t.includes('trade') ||
              t.includes('omnibus') || t.includes('hardcover') || t.includes('complete') ||
              t.includes('complet')
            )
          case 'manga':
            return t.includes('manga') || t.includes('tankobon') || t.includes(' vol.')
          default:
            return true
        }
      })
    }

    if (priceMax !== 'all') {
      const max = parseFloat(priceMax)
      if (!isNaN(max)) ls = ls.filter(l => l.price.value < max)
    }

    if (condition !== 'all') {
      ls = ls.filter(l => {
        const c = (l.condition || '').toLowerCase()
        if (condition === 'new')  return c === 'new'
        if (condition === 'used') return c !== 'new' && c !== '' && c !== 'unspecified'
        return true
      })
    }

    return ls
  }, [listings, formatFilter, priceMax, condition])

  const regionLabel = region === 'uk' ? 'United Kingdom' : 'United States'

  const FORMAT_PILLS: { value: 'all' | 'graphic-novel' | 'single-issue' | 'manga'; label: string }[] = [
    { value: 'all',           label: 'All' },
    { value: 'graphic-novel', label: 'Graphic Novels / TPB' },
    { value: 'single-issue',  label: 'Issues' },
    { value: 'manga',         label: 'Manga' },
  ]

  return (
    <div>
      {/* Listing card thumbnail hover — scale pops the cover without moving the whole card */}
      <style>{`
        .listing-thumb {
          transition: transform 0.32s cubic-bezier(0.34, 1.15, 0.64, 1), box-shadow 0.25s ease;
          will-change: transform;
        }
        .listing-card:hover .listing-thumb {
          transform: scale(1.13);
          box-shadow: 0 8px 24px rgba(0,0,0,0.22);
          position: relative;
          z-index: 2;
        }
      `}</style>

      {/* Header: format pills (left) + offer count (right) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', gap: '12px', flexWrap: 'wrap' }}>
        {onFormatChange ? (
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
            {FORMAT_PILLS.map(({ value, label }) => {
              const active = formatFilter === value
              return (
                <button
                  key={value}
                  onClick={() => onFormatChange(value)}
                  style={{
                    fontSize: '13px',
                    fontWeight: active ? 600 : 500,
                    padding: '6px 14px',
                    borderRadius: '20px',
                    cursor: 'pointer',
                    border: active ? '2px solid #E8272A' : '1.5px solid #D1D5DB',
                    background: active ? '#E8272A' : '#fff',
                    color: active ? '#fff' : '#374151',
                    fontFamily: 'inherit',
                    transition: 'all 0.15s',
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        ) : <div />}
        <p style={{ fontSize: '12px', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0, whiteSpace: 'nowrap' }}>
          {loading
            ? 'Loading offers…'
            : `${visibleListings.length} ${visibleListings.length === 1 ? 'offer' : 'offers'} · ${regionLabel}`}
        </p>
      </div>

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

      {/* Error state — shows actual eBay/network error for easier debugging */}
      {!loading && error && (
        <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-center">
          <p className="text-sm text-red-600 font-medium mb-1">Couldn&apos;t load listings</p>
          <p className="text-xs text-red-400 break-words">{error}</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && visibleListings.length === 0 && (
        <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center">
          <p className="text-sm text-gray-500">
            {listings.length > 0
              ? 'No listings match the active filters.'
              : 'No listings found for this title right now.'}
          </p>
        </div>
      )}

      {/* Listings */}
      {!loading && !error && visibleListings.length > 0 && (
        <ul className="space-y-3">
          {visibleListings.map((l, i) => {
            const isBest    = i === 0
            const feedback  = l.seller.feedbackPercentage > 0 ? `${l.seller.feedbackPercentage}% feedback` : ''
            const meta      = ['eBay', l.condition || 'Unspecified', l.seller.username, feedback].filter(Boolean).join(' · ')

            return (
              <li
                key={l.itemId}
                className="listing-card flex items-center gap-4 rounded-2xl bg-white"
                style={{
                  border: isBest ? '2px solid #E8272A' : '1px solid #F3F4F6',
                  padding: isBest ? '14px' : '12px',
                  transition: 'box-shadow 0.2s ease',
                  position: 'relative',
                  overflow: 'visible',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.boxShadow = '0 6px 24px rgba(0,0,0,0.10)'
                  e.currentTarget.style.zIndex = '1'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.boxShadow = 'none'
                  e.currentTarget.style.zIndex = 'auto'
                }}
              >
                {/* Cover thumbnail — scales independently on card hover, breaking containment slightly */}
                <div
                  className="listing-thumb relative rounded-md overflow-hidden bg-gray-50 border border-gray-200 shrink-0 flex items-center justify-center"
                  style={{ width: isBest ? '62px' : '53px', height: isBest ? '86px' : '74px' }}
                >
                  <span className="text-gray-300 text-sm font-medium" aria-hidden="true">
                    {(l.title.charAt(0) || '?').toUpperCase()}
                  </span>
                  {l.imageUrl && (
                    <img
                      src={l.imageUrl}
                      alt=""
                      className="absolute inset-0 w-full h-full"
                      style={{ objectFit: 'contain', padding: '2px' }}
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
          loading is done (regardless of eBay result count).
          Amazon tag is read from NEXT_PUBLIC_AMAZON_UK/US_ASSOCIATE_TAG.
          The tag is NOT a secret — it appears in every affiliate URL. ── */}
      {!loading && (
        <div className="mt-4 space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-gray-400 mb-2">Also search on</p>

          {/* Amazon — region-aware (UK → amazon.co.uk, US → amazon.com).
              Format-aware query suffix: manga listings say "manga", not "comic". */}
          {(() => {
            // Associate tags — set in .env.local and Vercel dashboard.
            // NEXT_PUBLIC_ prefix required so client components can read them.
            const tag = region === 'uk'
              ? (process.env.NEXT_PUBLIC_AMAZON_UK_ASSOCIATE_TAG || '')
              : (process.env.NEXT_PUBLIC_AMAZON_US_ASSOCIATE_TAG || '')

            // Use the active format filter as a hint for the Amazon search suffix.
            // 'all' → no strong format signal → use generic 'comic' suffix.
            const formatHint: ComicFormat = formatFilter !== 'all' ? formatFilter : undefined

            const amazonUrl = buildAmazonUrl({ title: query, region, format: formatHint, tag })

            return (
              <a
                href={amazonUrl}
                target="_blank"
                rel="noopener noreferrer sponsored"
                className="flex items-center gap-3 p-3 rounded-xl bg-white border border-gray-100 hover:border-gray-300 transition-colors group"
                aria-label={`Search Amazon for ${query}`}
              >
                {/* Amazon logo mark */}
                <div className="w-8 h-8 rounded-md bg-[#FF9900] flex items-center justify-center shrink-0 text-white font-bold text-xs">
                  a
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">Amazon</p>
                  <p className="text-xs text-gray-400">
                    {region === 'uk' ? 'Search Amazon UK' : 'Search Amazon US'}
                  </p>
                </div>
                <span className="text-xs text-gray-400 group-hover:text-gray-600 shrink-0">Search →</span>
              </a>
            )
          })()}

          {/* AbeBooks — region-aware (UK → abebooks.co.uk, US → abebooks.com).
              No live pricing API exists. Affiliate search link only.
              No price shown. Does not affect "From £…" on results page. */}
          <a
            href={buildAbeBooksUrl({ title: query, region })}
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
              <p className="text-xs text-gray-400">
                {region === 'uk' ? 'Search AbeBooks UK' : 'New, used & collectible'}
              </p>
            </div>
            <span className="text-xs text-gray-400 group-hover:text-gray-600 shrink-0">Search →</span>
          </a>

          {/* Forbidden Planet — UK specialist retailer. No live pricing API.
              Affiliate code read from NEXT_PUBLIC_FORBIDDEN_PLANET_AFFILIATE_CODE.
              The code is NOT a secret — it appears in the outbound URL.
              Only shown for UK region; FP ships internationally but is UK-native. */}
          {region === 'uk' && (() => {
            const fpCode = process.env.NEXT_PUBLIC_FORBIDDEN_PLANET_AFFILIATE_CODE || ''
            const fpUrl  = buildForbiddenPlanetSearchUrl(query, fpCode)
            return (
              <a
                href={fpUrl}
                target="_blank"
                rel="noopener noreferrer sponsored"
                className="flex items-center gap-3 p-3 rounded-xl bg-white border border-gray-100 hover:border-gray-300 transition-colors group"
                aria-label={`Search for ${query} on Forbidden Planet`}
              >
                {/* Forbidden Planet logo mark */}
                <div className="w-8 h-8 rounded-md bg-[#E8272A] flex items-center justify-center shrink-0 text-white font-bold text-xs">
                  FP
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">Forbidden Planet</p>
                  <p className="text-xs text-gray-400">UK specialist comic retailer</p>
                </div>
                <span className="text-xs text-gray-400 group-hover:text-gray-600 shrink-0">View on FP →</span>
              </a>
            )
          })()}
        </div>
      )}
    </div>
  )
}
