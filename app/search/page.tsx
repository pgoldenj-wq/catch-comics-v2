'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useState, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import SearchBar from '@/components/SearchBar'

interface ComicResult {
  id: number
  name: string
  image: { medium_url: string; original_url: string }
  start_year: string
  publisher: { name: string }
}

function SearchResults() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const query = searchParams.get('q') || ''
  const regionParam = searchParams.get('region') as 'uk' | 'us' | null
  const [results, setResults] = useState<ComicResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [region, setRegion] = useState<'uk' | 'us'>(regionParam || 'uk')
  const [didYouMean, setDidYouMean] = useState<string | null>(null)

  useEffect(() => {
    if (!query) return
    setLoading(true)
    setError('')
    setDidYouMean(null)
    fetch(`/api/search?q=${encodeURIComponent(query)}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) setError(data.error)
        else setResults(data.results || [])
        setLoading(false)
      })
      .catch(() => { setError('Something went wrong.'); setLoading(false) })
  }, [query])

  // Comic-aware spelling correction — fires after results load
  useEffect(() => {
    if (!query || loading) return
    // Always run correction — even with results, a suggestion can help
    fetch(`/api/autocomplete?q=${encodeURIComponent(query)}&mode=correct`)
      .then(r => r.json())
      .then(d => {
        if (d.correction && d.correction.toLowerCase() !== query.toLowerCase()) {
          setDidYouMean(d.correction)
        }
      })
      .catch(() => {})
  }, [query, loading])

  const switchRegion = (r: 'uk' | 'us') => {
    setRegion(r)
    router.push(`/search?q=${encodeURIComponent(query)}&region=${r}`)
  }

  const UKFlag = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30" width="24" height="12" aria-label="UK flag">
      <path d="M0 0v30h60V0z" fill="#012169"/>
      <path d="M0 0l60 30m0-30L0 30" stroke="#fff" strokeWidth="6"/>
      <path d="M0 0l60 30m0-30L0 30" stroke="#C8102E" strokeWidth="4"/>
      <path d="M30 0v30M0 15h60" stroke="#fff" strokeWidth="10"/>
      <path d="M30 0v30M0 15h60" stroke="#C8102E" strokeWidth="6"/>
    </svg>
  )
  const USFlag = () => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30" width="24" height="12" aria-label="US flag">
      <rect width="60" height="30" fill="#B22234"/>
      <path d="M0 3.46h60M0 6.92h60M0 10.38h60M0 13.85h60M0 17.31h60M0 20.77h60M0 24.23h60" stroke="#fff" strokeWidth="2.31"/>
      <rect width="24" height="16.15" fill="#3C3B6E"/>
      <g fill="#fff">{[...Array(5)].map((_, row) => [...Array(row%2===0?6:5)].map((_, col) => <circle key={`${row}-${col}`} cx={row%2===0?2+col*4:4+col*4} cy={2+row*3} r="0.9"/>))}</g>
    </svg>
  )

  return (
    <main className="min-h-screen font-sans" style={{ background: '#F8F8F6' }}>

      {/* HEADER — matches homepage */}
      <header style={{ background: '#fff', borderBottom: '1px solid #F0F0F0', position: 'sticky', top: 0, zIndex: 20 }}>
        <div className="max-w-6xl mx-auto px-8 h-20 flex items-center gap-4">
          <a href="/" className="shrink-0">
            <img src="/logo.png" alt="Catch Comics" className="h-12 w-auto" />
          </a>
          <div className="flex-1" style={{ maxWidth: '520px' }}>
            <SearchBar region={region} variant="header" initialQuery={query} />
          </div>
          <div className="flex items-center gap-3 ml-auto shrink-0">
            <button onClick={() => switchRegion('uk')}
              className="flex items-center gap-2.5 pl-2 pr-4 py-1.5 rounded-full border-2 transition-all"
              style={{ borderColor: region === 'uk' ? '#0A0A0A' : '#E5E7EB', background: region === 'uk' ? '#0A0A0A' : '#fff' }}>
              <span className="flex items-center justify-center rounded-full overflow-hidden shrink-0" style={{ width: '32px', height: '32px', background: '#f3f4f6' }}><UKFlag /></span>
              <span className="text-sm font-medium" style={{ color: region === 'uk' ? '#fff' : '#6B7280' }}>United Kingdom</span>
            </button>
            <button onClick={() => switchRegion('us')}
              className="flex items-center gap-2.5 pl-2 pr-4 py-1.5 rounded-full border-2 transition-all"
              style={{ borderColor: region === 'us' ? '#0A0A0A' : '#E5E7EB', background: region === 'us' ? '#0A0A0A' : '#fff' }}>
              <span className="flex items-center justify-center rounded-full overflow-hidden shrink-0" style={{ width: '32px', height: '32px', background: '#f3f4f6' }}><USFlag /></span>
              <span className="text-sm font-medium" style={{ color: region === 'us' ? '#fff' : '#6B7280' }}>United States</span>
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6">

        {!loading && !error && (
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm" style={{ color: '#6B7280' }}>
              <span className="font-medium" style={{ color: '#0A0A0A' }}>{results.length} results</span> for "{query}"
            </p>
            <div style={{ fontSize: '12px', color: '#9CA3AF' }}>Sorted by relevance</div>
          </div>
        )}

        {/* DID YOU MEAN — shows for both zero results and potential better matches */}
        {didYouMean && !loading && (
          <div className="mb-4 px-4 py-3 rounded-xl text-sm" style={{ background: '#fff', border: '1px solid #F0F0F0', color: '#6B7280' }}>
            Did you mean{' '}
            <button onClick={() => router.push(`/search?q=${encodeURIComponent(didYouMean)}&region=${region}`)}
              style={{ fontWeight: 600, color: '#E8272A', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              {didYouMean}
            </button>?
          </div>
        )}

        {loading && (
          <div className="space-y-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex gap-3 p-3 rounded-xl animate-pulse" style={{ border: '1px solid #F3F4F6' }}>
                <div className="w-12 h-16 rounded-md shrink-0" style={{ background: '#F3F4F6' }} />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-3.5 rounded w-3/4" style={{ background: '#F3F4F6' }} />
                  <div className="h-3 rounded w-1/2" style={{ background: '#F3F4F6' }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {error && <div className="text-center py-16" style={{ color: '#6B7280' }}>{error}</div>}

        {!loading && !error && results.length > 0 && (
          <div style={{ borderTop: '1px solid #F0F0F0' }}>
            {results.map((comic) => (
              <div key={comic.id}
                onClick={() => router.push(`/comic/${comic.id}?region=${region}`)}
                className="flex items-center gap-3 py-4 cursor-pointer"
                style={{ borderBottom: '1px solid #F0F0F0' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#FAFAFA')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <div className="shrink-0 rounded-md overflow-hidden" style={{ width: '44px', height: '62px', background: '#F3F4F6', border: '1px solid #EBEBEB' }}>
                  {comic.image?.medium_url
                    ? <img src={comic.image.medium_url} alt={comic.name} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center"><span style={{ color: '#9CA3AF', fontSize: '16px', fontWeight: 500 }}>{comic.name.charAt(0)}</span></div>
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-sm font-medium truncate" style={{ color: '#0A0A0A' }}>{comic.name}</h2>
                  <p className="text-xs mt-0.5" style={{ color: '#9CA3AF' }}>
                    {[comic.publisher?.name, comic.start_year].filter(Boolean).join(' · ')}
                  </p>
                  <span className="inline-block mt-1.5 text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: '#F3F4F6', color: '#6B7280', fontSize: '10px' }}>
                    Comic Series
                  </span>
                </div>
                <div className="shrink-0 text-right">
                  <div style={{ fontSize: '10px', color: '#9CA3AF', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '2px' }}>Compare</div>
                  <div style={{ fontSize: '13px', fontWeight: 500, color: '#E8272A' }}>Find prices →</div>
                  <div style={{ fontSize: '10px', color: '#9CA3AF', marginTop: '2px' }}>3 stores</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && !error && results.length === 0 && (
          <div className="text-center py-16">
            <p className="font-medium mb-2" style={{ color: '#0A0A0A' }}>No results for "{query}"</p>
            <p className="text-sm" style={{ color: '#6B7280' }}>Try searching by series name, character, or publisher</p>
          </div>
        )}
      </div>
    </main>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center font-sans" style={{ background: '#F8F8F6' }}>
        <p style={{ color: '#9CA3AF', fontSize: '14px' }}>Loading...</p>
      </div>
    }>
      <SearchResults />
    </Suspense>
  )
}