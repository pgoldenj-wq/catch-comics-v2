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
  const [results, setResults] = useState<ComicResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchInput, setSearchInput] = useState(query)

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
      router.push(`/search?q=${encodeURIComponent(searchInput.trim())}`)
    }
  }

  return (
    <main className="min-h-screen bg-white">
      <header className="sticky top-0 bg-white border-b border-[#F3F4F6] px-4 py-3 z-10">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <a href="/" className="text-xl font-bold shrink-0">
            <img src="/logo.png" alt="Catch Comics" className="h-8 w-auto" />
          </a>
          <form onSubmit={handleSearch} className="flex-1">
            <div className="relative flex items-center">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search any comic, graphic novel or manga..."
                className="w-full h-11 px-4 pr-12 text-sm text-[#0A0A0A] bg-white border border-[#E5E7EB] rounded-xl focus:outline-none focus:border-[#E8272A] focus:ring-2 focus:ring-[#E8272A]/10 transition-all placeholder:text-[#6B7280]"
              />
              <button
                type="submit"
                className="absolute right-1.5 flex items-center justify-center w-8 h-8 bg-[#E8272A] rounded-lg hover:bg-[#c41f22] transition-colors"
                aria-label="Search"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                </svg>
              </button>
            </div>
          </form>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {!loading && !error && (
          <p className="text-sm text-[#6B7280] mb-4">
            {results.length > 0
              ? `${results.length} results for "${query}"`
              : `No results found for "${query}"`}
          </p>
        )}

        {loading && (
          <div className="space-y-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex gap-4 p-4 border border-[#F3F4F6] rounded-2xl animate-pulse">
                <div className="w-16 h-24 bg-[#F3F4F6] rounded-lg shrink-0" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-4 bg-[#F3F4F6] rounded w-3/4" />
                  <div className="h-3 bg-[#F3F4F6] rounded w-1/2" />
                  <div className="h-3 bg-[#F3F4F6] rounded w-1/4" />
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="text-center py-12">
            <p className="text-[#6B7280]">{error}</p>
          </div>
        )}

        {!loading && !error && results.length > 0 && (
          <div className="space-y-3">
            {results.map((comic) => (
              <div
                key={comic.id}
                onClick={() => router.push('/comic/' + comic.id)}
                className="flex gap-4 p-4 border border-[#F3F4F6] rounded-2xl hover:border-[#E8272A]/30 hover:shadow-sm transition-all cursor-pointer"
              >
                <div className="shrink-0">
                  {comic.image?.medium_url ? (
                    <img src={comic.image.medium_url} alt={comic.name} className="w-16 h-24 object-cover rounded-lg" />
                  ) : (
                    <div className="w-16 h-24 bg-[#F3F4F6] rounded-lg flex items-center justify-center">
                      <span className="text-xs text-[#6B7280]">No image</span>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-[#0A0A0A] text-base leading-tight">{comic.name}</h2>
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {comic.publisher?.name && (
                      <span className="text-xs text-[#6B7280]">{comic.publisher.name}</span>
                    )}
                    {comic.start_year && (
                      <span className="text-xs text-[#6B7280]">· {comic.start_year}</span>
                    )}
                  </div>
                  <span className="inline-block mt-2 text-xs font-medium px-2 py-0.5 bg-[#F3F4F6] text-[#6B7280] rounded-full">
                    Comic Series
                  </span>
                </div>
                <div className="shrink-0 flex items-center">
                  <span className="text-sm font-semibold text-[#E8272A]">
                    Find Prices →
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && !error && results.length === 0 && (
          <div className="text-center py-12">
            <p className="text-[#0A0A0A] font-medium mb-2">No results found for "{query}"</p>
            <p className="text-sm text-[#6B7280]">Try searching by series name, character, or publisher</p>
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
        <p className="text-[#6B7280]">Loading...</p>
      </div>
    }>
      <SearchResults />
    </Suspense>
  )
}