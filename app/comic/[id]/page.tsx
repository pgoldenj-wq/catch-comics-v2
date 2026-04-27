'use client'

import { useEffect, useState, Suspense } from 'react'
import { useParams, useRouter } from 'next/navigation'

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
  price: string
  currency: string
  url: string
  flag: string
}

function ComicPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [comic, setComic] = useState<ComicDetail | null>(null)
  const [prices, setPrices] = useState<PriceResult[]>([])
  const [loading, setLoading] = useState(true)
  const [market, setMarket] = useState<'uk' | 'us'>('uk')

  useEffect(() => {
    if (!id) return
    fetch(`/api/comic/${id}`)
      .then(res => res.json())
      .then(data => {
        setComic(data.comic)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (!comic) return
    const amazonBase = market === 'uk'
      ? 'https://www.amazon.co.uk/s?k='
      : 'https://www.amazon.com/s?k='
    const amazonTag = market === 'uk' ? 'catchcomics-21' : 'catchcomics-us'
    const searchTerm = encodeURIComponent(comic.name + ' comic')

    setPrices([
      {
        seller: 'Amazon',
        condition: 'New',
        price: 'View on Amazon',
        currency: market === 'uk' ? '£' : '$',
        url: amazonBase + searchTerm + '&tag=' + amazonTag,
        flag: market === 'uk' ? '🇬🇧' : '🇺🇸'
      },
      {
        seller: 'eBay',
        condition: 'New & Used',
        price: 'View on eBay',
        currency: market === 'uk' ? '£' : '$',
        url: market === 'uk'
          ? 'https://www.ebay.co.uk/sch/i.html?_nkw=' + encodeURIComponent(comic.name + ' comic')
          : 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(comic.name + ' comic'),
        flag: market === 'uk' ? '🇬🇧' : '🇺🇸'
      },
      {
        seller: 'AbeBooks',
        condition: 'New & Used',
        price: 'View on AbeBooks',
        currency: market === 'uk' ? '£' : '$',
        url: 'https://www.abebooks.co.uk/servlet/SearchResults?kn=' + encodeURIComponent(comic.name),
        flag: market === 'uk' ? '🇬🇧' : '🇺🇸'
      }
    ])
  }, [comic, market])

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-[#6B7280]">Loading...</p>
      </div>
    )
  }

  if (!comic) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-[#6B7280]">Comic not found.</p>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-white">

      {/* Header */}
      <header className="sticky top-0 bg-white border-b border-[#F3F4F6] px-4 py-3 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <a href="/" className="text-xl font-bold shrink-0">
            <span className="text-[#E8272A]">Catch</span>
            <span className="text-[#0A0A0A]"> Comics</span>
          </a>
          <button
            onClick={() => router.back()}
            className="text-sm text-[#6B7280] hover:text-[#0A0A0A] transition-colors"
          >
            Back to results
          </button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8">

        {/* Comic Details */}
        <div className="flex gap-6 mb-8">
          {comic.image?.medium_url && (
            <img
              src={comic.image.medium_url}
              alt={comic.name}
              className="w-32 h-48 object-cover rounded-xl shadow-sm shrink-0"
            />
          )}
          <div>
            <h1 className="text-2xl font-bold text-[#0A0A0A] mb-2">{comic.name}</h1>
            {comic.publisher?.name && (
              <p className="text-sm text-[#6B7280] mb-1">{comic.publisher.name}</p>
            )}
            {comic.start_year && (
              <p className="text-sm text-[#6B7280] mb-3">First published {comic.start_year}</p>
            )}
            <span className="inline-block text-xs font-medium px-2 py-0.5 bg-[#F3F4F6] text-[#6B7280] rounded-full">
              Comic Series
            </span>
          </div>
        </div>

        {/* Market Selector */}
        <div className="flex items-center gap-2 mb-6">
          <p className="text-sm font-medium text-[#0A0A0A]">Show prices for:</p>
          <button
            onClick={() => setMarket('uk')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              market === 'uk'
                ? 'bg-[#E8272A] text-white'
                : 'bg-[#F3F4F6] text-[#6B7280] hover:bg-[#E5E7EB]'
            }`}
          >
            🇬🇧 UK
          </button>
          <button
            onClick={() => setMarket('us')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              market === 'us'
                ? 'bg-[#E8272A] text-white'
                : 'bg-[#F3F4F6] text-[#6B7280] hover:bg-[#E5E7EB]'
            }`}
          >
            🇺🇸 US
          </button>
        </div>

        {/* Price Results */}
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-[#0A0A0A]">
            Where to buy — {market === 'uk' ? '🇬🇧 UK' : '🇺🇸 US'}
          </h2>
          {prices.map((price, i) => (
            <div
              key={i}
              className="flex items-center justify-between p-4 border border-[#F3F4F6] rounded-2xl hover:border-[#E8272A]/30 hover:shadow-sm transition-all"
            >
              <div>
                <p className="font-semibold text-[#0A0A0A]">{price.seller}</p>
                <p className="text-xs text-[#6B7280] mt-0.5">{price.condition}</p>
              </div>
              <button
                onClick={() => window.open(price.url, '_blank')}
                className="text-sm font-semibold text-white bg-[#E8272A] px-4 py-2 rounded-xl transition-colors whitespace-nowrap"
              >
                View Prices
              </button>
            </div>
          ))}
        </div>

      </div>
    </main>
  )
}

export default function ComicPageWrapper() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-[#6B7280]">Loading...</p>
      </div>
    }>
      <ComicPage />
    </Suspense>
  )
}