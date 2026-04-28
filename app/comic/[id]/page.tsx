'use client'

import { useEffect, useState, Suspense } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'

interface ComicDetail {
  id: number
  name: string
  image: { medium_url: string; original_url: string }
  start_year: string
  publisher: { name: string }
  description: string
  count_of_issues: number
}

interface PriceResult {
  seller: string
  condition: string
  url: string
  isFirst?: boolean
}

function ComicPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const id = params.id as string
  const regionParam = searchParams.get('region') as 'uk' | 'us' | null

  const [comic, setComic] = useState<ComicDetail | null>(null)
  const [prices, setPrices] = useState<PriceResult[]>([])
  const [loading, setLoading] = useState(true)
  const [market, setMarket] = useState<'uk' | 'us'>(regionParam || 'uk')
  const [activeTab, setActiveTab] = useState<'all' | 'new' | 'used'>('all')

  useEffect(() => {
    if (!id) return
    fetch('/api/comic/' + id)
      .then(res => res.json())
      .then(data => {
        setComic(data.comic)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (!comic) return
    const searchTerm = encodeURIComponent(comic.name + ' comic')
    const amazonTag = market === 'uk' ? 'catchcomics-21' : 'catchcomics-us'
    const amazonUrl = market === 'uk'
      ? `https://www.amazon.co.uk/s?k=${searchTerm}&tag=${amazonTag}`
      : `https://www.amazon.com/s?k=${searchTerm}&tag=${amazonTag}`
    const ebayUrl = market === 'uk'
      ? `https://www.ebay.co.uk/sch/i.html?_nkw=${searchTerm}`
      : `https://www.ebay.com/sch/i.html?_nkw=${searchTerm}`
    const abebooksUrl = `https://www.abebooks.co.uk/servlet/SearchResults?kn=${encodeURIComponent(comic.name)}`

    setPrices([
      { seller: 'Amazon', condition: 'New', url: amazonUrl, isFirst: true },
      { seller: 'eBay', condition: 'New & Used', url: ebayUrl },
      { seller: 'AbeBooks', condition: 'New & Used', url: abebooksUrl },
    ])
  }, [comic, market])

  const filteredPrices = prices.filter(p => {
    if (activeTab === 'new') return p.condition === 'New'
    if (activeTab === 'used') return p.condition.includes('Used')
    return true
  })

  const sellerColour: Record<string, string> = {
    Amazon: 'text-amber-700',
    eBay: 'text-blue-700',
    AbeBooks: 'text-green-700',
  }

  if (loading) {
    return (
      <div className="min-h-screen font-sans" style={{ background: '#F8F8F6' }}>
        <nav className="bg-white border-b border-gray-100 px-6 h-20 flex items-center">
          <img src="/logo.png" alt="Catch Comics" className="h-12 w-auto" />
        </nav>
        <div className="bg-[#111827] px-6 py-8 animate-pulse">
          <div className="flex gap-5 max-w-3xl mx-auto">
            <div className="w-24 h-32 bg-white/10 rounded-lg shrink-0" />
            <div className="flex-1 space-y-3 pt-1">
              <div className="h-3 bg-white/10 rounded w-1/3" />
              <div className="h-5 bg-white/10 rounded w-2/3" />
              <div className="h-3 bg-white/10 rounded w-1/4" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!comic) {
    return (
      <div className="min-h-screen flex items-center justify-center font-sans" style={{ background: '#F8F8F6' }}>
        <p className="text-gray-400 text-sm">Comic not found.</p>
      </div>
    )
  }

  return (
    <main className="min-h-screen font-sans" style={{ background: '#F8F8F6' }}>

      {/* NAV */}
      <nav className="sticky top-0 z-20 bg-white border-b border-gray-100 px-8 h-20 flex items-center justify-between">
        <a href="/">
          <img src="/logo.png" alt="Catch Comics" className="h-12 w-auto" />
        </a>
        <button
          onClick={() => router.back()}
          className="text-xs text-gray-400 hover:text-gray-700 transition-colors flex items-center gap-1"
        >
          ← Back to results
        </button>
      </nav>

      {/* DARK HEADER */}
      <div className="relative bg-[#111827] overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
          }}
        />
        <div className="relative px-8 py-8 flex gap-6 max-w-4xl mx-auto">
          {comic.image?.medium_url ? (
            <img
              src={comic.image.medium_url}
              alt={comic.name}
              className="w-28 h-40 object-cover rounded-lg border border-white/10 shadow-xl shrink-0"
            />
          ) : (
            <div className="w-28 h-40 bg-white/5 rounded-lg border border-white/10 flex items-center justify-center shrink-0">
              <span className="text-white/30 text-3xl font-medium">{comic.name.charAt(0)}</span>
            </div>
          )}
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            <p className="text-white/40 text-xs mb-2">
              {[comic.publisher?.name, comic.start_year ? `Est. ${comic.start_year}` : null].filter(Boolean).join(' · ')}
            </p>
            <h1 className="text-white text-2xl font-semibold leading-tight tracking-tight mb-2">
              {comic.name}
            </h1>
            <p className="text-white/40 text-xs mb-6">Comic Series</p>

            {/* REGION TOGGLE */}
            <div className="flex items-center gap-2">
              <span className="text-white/30 text-xs">Prices for:</span>
              {(['uk', 'us'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setMarket(r)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
                  style={{
                    borderColor: market === r ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)',
                    background: market === r ? 'rgba(255,255,255,0.1)' : 'transparent',
                    color: market === r ? '#fff' : 'rgba(255,255,255,0.35)',
                  }}
                >
                  {r === 'uk' ? '🇬🇧 UK' : '🇺🇸 US'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* OFFERS */}
      <div className="max-w-4xl mx-auto px-8 py-6">

        {/* TABS */}
        <div className="flex border-b border-gray-200 mb-5">
          {(['all', 'new', 'used'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-4 py-2.5 text-sm capitalize font-medium border-b-2 transition-all -mb-px"
              style={{
                borderColor: activeTab === tab ? '#E8272A' : 'transparent',
                color: activeTab === tab ? '#E8272A' : '#9CA3AF',
              }}
            >
              {tab === 'all' ? 'All offers' : tab}
            </button>
          ))}
        </div>

        <p className="text-xs text-gray-400 mb-4 uppercase tracking-wide">
          {filteredPrices.length} {filteredPrices.length === 1 ? 'offer' : 'offers'} · {market === 'uk' ? 'United Kingdom' : 'United States'}
        </p>

        <div className="space-y-3">
          {filteredPrices.map((price, i) => (
            <div
              key={i}
              className="flex items-center gap-4 p-4 rounded-2xl bg-white transition-all"
              style={{
                border: price.isFirst ? '2px solid #E8272A' : '1px solid #F3F4F6',
              }}
            >
              {price.isFirst && (
                <span className="text-[10px] font-semibold uppercase tracking-wide bg-[#E8272A] text-white px-2 py-1 rounded-md shrink-0">
                  Best
                </span>
              )}
              {!price.isFirst && <div className="w-10 shrink-0" />}

              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${sellerColour[price.seller] || 'text-gray-900'}`}>
                  {price.seller}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{price.condition}</p>
              </div>

              <button
                onClick={() => window.open(price.url, '_blank')}
                className="shrink-0 px-5 py-2 text-white text-xs font-semibold rounded-xl transition-colors"
                style={{ background: '#0A0A0A' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#E8272A')}
                onMouseLeave={e => (e.currentTarget.style.background = '#0A0A0A')}
              >
                View deal →
              </button>
            </div>
          ))}

          {filteredPrices.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">No {activeTab} offers available</p>
          )}
        </div>

        <p className="text-xs text-gray-300 mt-8 leading-relaxed">
          Catch Comics links to third-party retailers. Prices and availability may vary.
          Amazon links include our affiliate tag which helps support the site at no extra cost to you.
        </p>
      </div>
    </main>
  )
}

export default function ComicPageWrapper() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center font-sans" style={{ background: '#F8F8F6' }}>
        <p className="text-gray-400 text-sm">Loading...</p>
      </div>
    }>
      <ComicPage />
    </Suspense>
  )
}