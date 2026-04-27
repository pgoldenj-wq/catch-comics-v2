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
  url: string
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
      ? 'https://www.amazon.co.uk/s?k=' + searchTerm + '&tag=' + amazonTag
      : 'https://www.amazon.com/s?k=' + searchTerm + '&tag=' + amazonTag
    const ebayUrl = market === 'uk'
      ? 'https://www.ebay.co.uk/sch/i.html?_nkw=' + searchTerm
      : 'https://www.ebay.com/sch/i.html?_nkw=' + searchTerm
    const abebooksUrl = 'https://www.abebooks.co.uk/servlet/SearchResults?kn=' + encodeURIComponent(comic.name)

    setPrices([
      { seller: 'Amazon', condition: 'New', url: amazonUrl },
      { seller: 'eBay', condition: 'New & Used', url: ebayUrl },
      { seller: 'AbeBooks', condition: 'New & Used', url: abebooksUrl }
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

      <header className="sticky top-0 bg-white border-b border-[#F3F4F6] px-4 py-3 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <a href="/">
            <img src="/logo.png" alt="Catch Comics" className="h-8 w-auto" />
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

        <div className="flex items-center gap-2 mb-6">
          <p className="text-sm font-medium text-[#0A0A0A]">Show prices for:</p>
          <button
            onClick={() => setMarket('uk')}
            className={'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all border-2 ' + (market === 'uk' ? 'border-[#E8272A] text-[#E8272A] bg-white' : 'border-[#E5E7EB] text-[#6B7280] bg-white hover:border-[#E8272A] hover:text-[#E8272A]')}
          >
            <img src="https://flagcdn.com/w40/gb.png" alt="UK" className="w-7 h-auto rounded-sm" />
            UK
          </button>
          <button
            onClick={() => setMarket('us')}
            className={'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all border-2 ' + (market === 'us' ? 'border-[#E8272A] text-[#E8272A] bg-white' : 'border-[#E5E7EB] text-[#6B7280] bg-white hover:border-[#E8272A] hover:text-[#E8272A]')}
          >
            <img src="https://flagcdn.com/w40/us.png" alt="US" className="w-7 h-auto rounded-sm" />
            US
          </button>
        </div>

        <div className="space-y-3">
          <h2 className="text-base font-semibold text-[#0A0A0A]">
            Where to buy — {market === 'uk' ? 'UK' : 'US'}
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