'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useState, Suspense } from 'react'
import { useRouter } from 'next/navigation'

interface ComicResult {
  id: number
  name: string
  image: { medium_url: string; original_url: string }
  start_year: string
  publisher: { name: string }
  description: string
}

function SearchResults() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const query = searchParams.get('q') || ''
  const regionParam = searchParams.get('region') as 'uk' | 'us' | null
  const [results, setResults] = useState<ComicResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchInput, setSearchInput] = useState(query)
  const [region, setRegion] = useState<'uk' | 'us'>(regionParam || 'uk')

  useEffect(() => {
    if (!query) return
    setLoading(true)
    setError('')
    fetch(`/api/search?q=${encodeURIComponent(query)}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) setError(data.error)
        else setResults(data.results || [])
        setLoading(false)
      })
      .catch(() => {
        setError('Something went wrong. Please try again.')
        setLoading(false)
      })
  }, [query])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchInput.trim()) {
      router.push(`/search?q=${encodeURIComponent(searchInput.trim())}&region=${region}`)
    }
  }

  const switchRegion = (r: 'uk' | 'us') => {
    setRegion(r)
    router.push(`/search?q=${encodeURIComponent(query)}&region=${r}`)
  }

  return (
    <main className="min-h-screen bg-white font-sans">

      {/* NAV */}
      <nav className="sticky top-0 z-20 bg-[#0A0A0A] border-b-2 border-[#E8272A] px-4 py-0 h-14 flex items-center gap-4">
        <a href="/" className="shrink-0">
          <img src="/logo.png" alt="Catch Comics" className="h-7 w-auto" />
        </a>

        <form onSubmit={handleSearch} className="flex-1 flex items-center bg-white rounded-full pl-4 pr-1.5 py-1 max-w-xl">
          <svg className="w-3.5 h-3.5 text-gray-400 shrink-0 mr-2" fill="none" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search any comic, graphic novel or manga..."
            className="flex-1 bg-transparent text-[#0A0A0A] text-sm outline-none placeholder:text-gray-400 py-1.5"
          />
          <button
            type="submit"
            className="w-8 h-8 rounded-full bg-[#0A0A0A] flex items-center justify-center shrink-0 hover:bg-[#E8272A] transition-colors"
          >
            <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24">
              <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </form>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => switchRegion('uk')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
              region === 'uk' ? 'bg-white/10 text-white border-white/30' : 'text-white/40 border-white/10'
            }`}
          >
            🇬🇧 UK
          </button>
          <button
            onClick={() => switchRegion('us')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
              region === 'us' ? 'bg-white/10 text-white border-white/30' : 'text-white/40 border-white/10'
            }`}
          >
            🇺🇸 US
          </button>
        </div>
      </nav>

      {/* RESULTS */}
      <div className="max-w-3xl mx-auto px-4 py-5">

        {!loading && !error && (
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">
              <span className="font-medium text-[#0A0A0A]">{results.length} results</span> for "{query}"
            </p>
            <div className="text-xs text-gray-400">Sorted by relevance</div>
          </div>
        )}

        {/* SKELETON */}
        {loading && (
          <div className="space-y-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex gap-3 p-3 border border-gray-100 rounded-xl animate-pulse">
                <div className="w-12 h-16 bg-gray-100 rounded-md shrink-0" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-3.5 bg-gray-100 rounded w-3/4" />
                  <div className="h-3 bg-gray-100 rounded w-1/2" />
                  <div className="h-3 bg-gray-100 rounded w-1/4" />
                </div>
                <div className="w-16 h-8 bg-gray-100 rounded-full self-center shrink-0" />
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="text-center py-16">
            <p className="text-gray-500">{error}</p>
          </div>
        )}

        {!loading && !error && results.length > 0 && (
          <div className="divide-y divide-gray-100">
            {results.map((comic) => (
              <div
                key={comic.id}
                onClick={() => router.push(`/comic/${comic.id}?region=${region}`)}
                className="flex items-center gap-3 py-3.5 cursor-pointer group"
              >
                {/* COVER */}
                <div className="shrink-0 w-11 h-16 rounded-md overflow-hidden bg-gray-100 border border-gray-200">
                  {comic.image?.medium_url ? (
                    <img
                      src={comic.image.medium_url}
                      alt={comic.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-gray-400 text-lg font-medium">
                        {comic.name.charAt(0)}
                      </span>
                    </div>
                  )}
                </div>

                {/* INFO */}
                <div className="flex-1 min-w-0">
                  <h2 className="text-sm font-medium text-[#0A0A0A] truncate group-hover:text-[#E8272A] transition-colors">
                    {comic.name}
                  </h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {[comic.publisher?.name, comic.start_year].filter(Boolean).join(' · ')}
                  </p>
                  <span className="inline-block mt-1.5 text-[10px] font-medium px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full">
                    Comic Series
                  </span>
                </div>

                {/* PRICE CTA */}
                <div className="shrink-0 text-right">
                  <div className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide">Compare</div>
                  <div className="text-sm font-medium text-[#E8272A] group-hover:underline">
                    Find prices →
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5">3 stores</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && !error && results.length === 0 && (
          <div className="text-center py-16">
            <p className="text-[#0A0A0A] font-medium mb-2">No results for "{query}"</p>
            <p className="text-sm text-gray-500">Try searching by series name, character, or publisher</p>
          </div>
        )}
      </div>
    </main>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-gray-400 text-sm">Loading...</p>
      </div>
    }>
      <SearchResults />
    </Suspense>
  )
}