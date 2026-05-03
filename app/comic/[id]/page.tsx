'use client'

import { useEffect, useState, Suspense } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import PricingPanel from '@/components/PricingPanel'

interface ComicDetail {
  id: number
  name: string
  image: { medium_url: string; original_url: string }
  start_year: string
  publisher: { name: string }
  description: string
  count_of_issues: number
}

interface IssueListItem {
  id: number
  issue_number: string
  name: string
  image: { small_url: string; medium_url: string }
  cover_year: string
  cover_date: string
}

function ComicPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const id = params.id as string
  const regionParam = searchParams.get('region') as 'uk' | 'us' | null

  const [comic, setComic] = useState<ComicDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [market, setMarket] = useState<'uk' | 'us'>(regionParam || 'uk')
  const [issues, setIssues]               = useState<IssueListItem[]>([])
  const [issuesLoading, setIssuesLoading] = useState(false)

  // True only for numeric Comic Vine volume IDs — issues (i-prefixed) and
  // Open Library books (ol-prefixed) don't have child issues to list.
  const isVolume = /^\d+$/.test(id)

  useEffect(() => {
    if (!id) return

    if (id.startsWith('ol-')) {
      // Open Library ISBN result — fetch book data directly, Comic Vine won't have it
      const isbn = id.slice(3)
      fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&jscmd=data&format=json`)
        .then(r => r.json())
        .then(data => {
          const book = data[`ISBN:${isbn}`]
          if (book) {
            setComic({
              id: 0,
              name: book.title || 'Unknown Title',
              image: {
                medium_url: book.cover?.medium || book.cover?.large || `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg`,
                original_url: book.cover?.large || `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`,
              },
              start_year: (book.publish_date as string | undefined)?.match(/\d{4}/)?.[0] || '',
              publisher: { name: (book.publishers as Array<{ name: string }> | undefined)?.[0]?.name || '' },
              description: '',
              count_of_issues: 1,
            })
          }
          setLoading(false)
        })
        .catch(() => setLoading(false))
      return
    }

    // Standard Comic Vine fetch
    fetch('/api/comic/' + id)
      .then(res => res.json())
      .then(data => {
        setComic(data.comic)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  // Fetch the full issue list for a volume — runs in parallel with the volume detail
  // fetch so the issues grid appears as soon as it's ready.
  useEffect(() => {
    if (!isVolume) return
    setIssuesLoading(true)
    fetch(`/api/comic/${id}/issues`)
      .then(res => res.json())
      .then(data => {
        setIssues(Array.isArray(data.issues) ? data.issues : [])
        setIssuesLoading(false)
      })
      .catch(() => setIssuesLoading(false))
  }, [id, isVolume])

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
          {/* Cover — letter always visible as fallback; image overlays and removes
              itself via onError if the URL is missing or returns an error */}
          <div className="relative w-28 h-40 rounded-lg border border-white/10 shadow-xl shrink-0 bg-white/5 flex items-center justify-center overflow-hidden">
            <span className="text-white/30 text-3xl font-medium absolute">{comic.name.charAt(0)}</span>
            {comic.image?.medium_url && (
              <img
                src={comic.image.medium_url}
                alt={comic.name}
                className="absolute inset-0 w-full h-full object-cover"
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
              />
            )}
          </div>
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            <p className="text-white/40 text-xs mb-2">
              {[comic.publisher?.name, comic.start_year ? `Est. ${comic.start_year}` : null].filter(Boolean).join(' · ')}
            </p>
            <h1 className="text-white text-2xl font-semibold leading-tight tracking-tight mb-2">
              {comic.name}
            </h1>
            <p className="text-white/40 text-xs mb-6">
              {/^i\d+$/.test(id) ? 'Single Issue' : 'Comic Series'}
            </p>

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

      {/* OFFERS — live eBay listings via /api/prices */}
      <div className="max-w-4xl mx-auto px-8 py-6">
        <PricingPanel query={comic.name} region={market} />
        <p className="text-xs text-gray-300 mt-8 leading-relaxed">
          Catch Comics links to third-party retailers. Prices and availability may vary.
        </p>
      </div>

      {/* ── ISSUES GRID — only for volumes with multiple issues ─────────────── */}
      {isVolume && (issuesLoading || issues.length > 0) && (
        <div className="max-w-4xl mx-auto px-8 pb-12">
          <div className="border-t border-gray-200 pt-8">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-900">
                Issues in this series
              </h2>
              {!issuesLoading && issues.length > 0 && (
                <span className="text-xs text-gray-400">
                  {issues.length} {issues.length === 1 ? 'issue' : 'issues'}
                </span>
              )}
            </div>

            {issuesLoading ? (
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}>
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="animate-pulse">
                    <div className="rounded-md bg-gray-100" style={{ aspectRatio: '2 / 3' }} />
                    <div className="h-3 bg-gray-100 rounded mt-2 w-1/2" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}>
                {issues.map(issue => {
                  const cover  = issue.image.medium_url || issue.image.small_url
                  const label  = issue.issue_number ? `#${issue.issue_number}` : (issue.name || 'Issue')
                  const sub    = issue.cover_year || ''
                  return (
                    <button
                      key={issue.id}
                      onClick={() => router.push(`/comic/i${issue.id}?region=${market}`)}
                      className="text-left bg-transparent border-0 p-0 cursor-pointer group"
                    >
                      <div className="relative rounded-md overflow-hidden bg-gray-100 border border-gray-200 transition-shadow group-hover:shadow-md" style={{ aspectRatio: '2 / 3' }}>
                        <span className="absolute inset-0 flex items-center justify-center text-gray-400 text-base font-medium">
                          {label}
                        </span>
                        {cover && (
                          <img
                            src={cover}
                            alt={`${comic.name} ${label}`}
                            className="absolute inset-0 w-full h-full object-cover"
                            loading="lazy"
                            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                          />
                        )}
                      </div>
                      <div className="mt-1.5 text-xs font-medium text-gray-900 truncate">{label}</div>
                      {sub && <div className="text-[11px] text-gray-400">{sub}</div>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

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