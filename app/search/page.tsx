'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useState, useMemo, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import SearchBar from '@/components/SearchBar'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ComicResult {
  id: number | string
  name: string
  image: { medium_url: string; original_url: string }
  start_year: string
  publisher: { name: string }
  count_of_issues?: number
  source?: string
  type?: string           // 'volume' | 'issue' | 'book'
  relevanceScore?: number
  authors?: string[]
  isbn13?: string
  isbn10?: string
}

type Format = 'single-issue' | 'graphic-novel' | 'hardcover' | 'omnibus' | 'manga' | 'compact' | 'one-shot'
type Category = 'comics' | 'manga' | 'indie'

// ─── Format / Category Detection ─────────────────────────────────────────────

const MANGA_PUBLISHERS = ['viz', 'kodansha', 'yen press', 'seven seas', 'tokyopop', 'square enix', 'shonen jump', 'dark horse manga', 'j-novel', 'vertical']
const INDIE_PUBLISHERS  = ['image', 'boom', 'dark horse', 'fantagraphics', 'oni press', 'dynamite', 'aftershock', 'vault', 'idw', 'drawn & quarterly', 'top shelf']

function detectFormat(comic: ComicResult): Format {
  // Actual Comic Vine issue records always get 'single-issue' regardless of name
  if (comic.source === 'cv_issue') return 'single-issue'
  const name = (comic.name || '').toLowerCase()
  const pub  = (comic.publisher?.name || '').toLowerCase()
  if (MANGA_PUBLISHERS.some(p => pub.includes(p))) return 'manga'
  // One-shot / annuals — checked before general heuristics to avoid mislabelling
  if (
    name.includes('annual') ||
    name.includes('one-shot') ||
    name.includes('one shot') ||
    name.includes('giant-size') ||
    name.includes('giant size') ||
    name.endsWith(' special') ||
    name.includes(' special #')
  ) return 'one-shot'
  if (name.includes('omnibus')) return 'omnibus'
  if (name.includes('absolute') || name.includes('deluxe') || name.endsWith(' hc') || name.includes('hardcover')) return 'hardcover'
  if (name.includes('pocket') || name.includes('compact')) return 'compact'
  return 'graphic-novel'
}

function detectCategory(comic: ComicResult): Category {
  const pub = (comic.publisher?.name || '').toLowerCase()
  if (MANGA_PUBLISHERS.some(p => pub.includes(p))) return 'manga'
  if (INDIE_PUBLISHERS.some(p => pub.includes(p))) return 'indie'
  return 'comics'
}

const FORMAT_LABELS: Record<Format, string> = {
  'single-issue':  'Single Issue',
  'graphic-novel': 'Graphic Novel / TPB',
  'hardcover':     'Hardcover Edition',
  'omnibus':       'Omnibus / Deluxe',
  'manga':         'Manga',
  'compact':       'Compact / Pocket',
  'one-shot':      'One-Shot / Annual',
}

const FORMAT_STYLES: Record<Format, { bg: string; color: string }> = {
  'single-issue':  { bg: '#FFE4E6', color: '#9F1239' },
  'graphic-novel': { bg: '#DBEAFE', color: '#1E40AF' },
  'hardcover':     { bg: '#EDE9FE', color: '#5B21B6' },
  'omnibus':       { bg: '#FCE7F3', color: '#9D174D' },
  'manga':         { bg: '#FEF3C7', color: '#92400E' },
  'compact':       { bg: '#D1FAE5', color: '#065F46' },
  'one-shot':      { bg: '#FEF9C3', color: '#854D0E' },
}

// ─── Flag SVGs ────────────────────────────────────────────────────────────────

// slice fills the circular container entirely; xMid/xMin controls which part of the flag shows.
// UK: centre the Union Jack. US: show the left side (canton / stars).
function UKFlag() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice" style={{ width: '100%', height: '100%', display: 'block' }} aria-label="UK flag">
      <path d="M0 0v30h60V0z" fill="#012169"/>
      <path d="M0 0l60 30m0-30L0 30" stroke="#fff" strokeWidth="6"/>
      <path d="M0 0l60 30m0-30L0 30" stroke="#C8102E" strokeWidth="4"/>
      <path d="M30 0v30M0 15h60" stroke="#fff" strokeWidth="10"/>
      <path d="M30 0v30M0 15h60" stroke="#C8102E" strokeWidth="6"/>
    </svg>
  )
}

function USFlag() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30" preserveAspectRatio="xMinYMid slice" style={{ width: '100%', height: '100%', display: 'block' }} aria-label="US flag">
      <rect width="60" height="30" fill="#B22234"/>
      <path d="M0 3.46h60M0 6.92h60M0 10.38h60M0 13.85h60M0 17.31h60M0 20.77h60M0 24.23h60" stroke="#fff" strokeWidth="2.31"/>
      <rect width="24" height="16.15" fill="#3C3B6E"/>
      <g fill="#fff">{[...Array(5)].map((_, row) => [...Array(row % 2 === 0 ? 6 : 5)].map((_, col) => (
        <circle key={`${row}-${col}`} cx={row % 2 === 0 ? 2 + col * 4 : 4 + col * 4} cy={2 + row * 3} r="0.9" />
      )))}</g>
    </svg>
  )
}

// ─── Filter Panel ─────────────────────────────────────────────────────────────

interface FilterPanelProps {
  format: string
  category: string
  publisher: string
  publishers: string[]
  currency: string
  onChange: (key: string, value: string) => void
  onClear: () => void
}

function FilterPanel({ format, category, publisher, publishers, currency, onChange, onClear }: FilterPanelProps) {
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['format', 'publisher']))

  const toggleSection = (id: string) => setOpenSections(prev => {
    const s = new Set(prev)
    s.has(id) ? s.delete(id) : s.add(id)
    return s
  })

  const hasActive = format !== 'all' || category !== 'all' || publisher !== 'all'

  const sectionHeader = (id: string, label: string) => (
    <button
      onClick={() => toggleSection(id)}
      style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        width: '100%', background: 'none', border: 'none', cursor: 'pointer',
        padding: '10px 0', fontSize: '10px', fontWeight: 700,
        letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6B7280',
        fontFamily: 'inherit',
      }}>
      {label}
      <span style={{
        fontSize: '9px', display: 'inline-block', transition: 'transform 0.15s',
        transform: openSections.has(id) ? 'rotate(180deg)' : 'none',
      }}>▼</span>
    </button>
  )

  const radioOption = (group: string, value: string, current: string, label: string) => {
    const active = value === current
    return (
      <button
        key={value}
        onClick={() => onChange(group, value)}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
          background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
          textAlign: 'left', fontFamily: 'inherit',
        }}>
        <span style={{
          width: '14px', height: '14px', borderRadius: '50%', flexShrink: 0,
          border: `2px solid ${active ? '#E8272A' : '#D1D5DB'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff',
        }}>
          {active && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#E8272A', display: 'block' }} />}
        </span>
        <span style={{ fontSize: '13px', color: active ? '#0A0A0A' : '#6B7280', fontWeight: active ? 500 : 400 }}>
          {label}
        </span>
      </button>
    )
  }

  return (
    <div>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <span style={{ fontSize: '14px', fontWeight: 600, color: '#0A0A0A' }}>Filters</span>
        {hasActive && (
          <button onClick={onClear} style={{ fontSize: '11px', color: '#E8272A', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
            Clear all
          </button>
        )}
      </div>

      {/* FORMAT */}
      <div style={{ borderTop: '1px solid #F0F0F0' }}>
        {sectionHeader('format', 'Format')}
        {openSections.has('format') && (
          <div style={{ paddingBottom: '14px' }}>
            {([
              ['all',           'All formats'],
              ['single-issue',  'Single Issues'],
              ['graphic-novel', 'Graphic Novels / TPB'],
              ['manga',         'Manga'],
              ['hardcover',     'Hardcover Edition'],
              ['omnibus',       'Omnibus / Deluxe'],
              ['one-shot',      'One-Shot / Annual'],
              ['compact',       'Compact / Pocket'],
            ] as [string, string][]).map(([v, l]) => radioOption('format', v, format, l))}
          </div>
        )}
      </div>

      {/* CATEGORY */}
      <div style={{ borderTop: '1px solid #F0F0F0' }}>
        {sectionHeader('category', 'Category')}
        {openSections.has('category') && (
          <div style={{ paddingBottom: '14px' }}>
            {([
              ['all',    'All categories'],
              ['comics', 'Comics (Western)'],
              ['manga',  'Manga'],
              ['indie',  'Indie / Small Press'],
            ] as [string, string][]).map(([v, l]) => radioOption('category', v, category, l))}
          </div>
        )}
      </div>

      {/* PUBLISHER — dynamic from results */}
      {publishers.length > 0 && (
        <div style={{ borderTop: '1px solid #F0F0F0' }}>
          {sectionHeader('publisher', 'Publisher')}
          {openSections.has('publisher') && (
            <div style={{ paddingBottom: '14px' }}>
              {radioOption('publisher', 'all', publisher, 'All publishers')}
              {publishers.map(p => radioOption('publisher', p, publisher, p))}
            </div>
          )}
        </div>
      )}

      {/* PRICE RANGE — placeholder until store pricing is wired */}
      <div style={{ borderTop: '1px solid #F0F0F0' }}>
        {sectionHeader('price', `Price Range (${currency})`)}
        {openSections.has('price') && (
          <div style={{ paddingBottom: '14px' }}>
            <p style={{ fontSize: '12px', color: '#9CA3AF', margin: 0, lineHeight: 1.6 }}>
              Price filters apply when browsing store listings.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Search Results ───────────────────────────────────────────────────────────

function SearchResults() {
  const searchParams = useSearchParams()
  const router = useRouter()

  // URL-derived values — all filter state lives in the URL
  const query     = searchParams.get('q') || ''
  const regionParam = searchParams.get('region') as 'uk' | 'us' | null
  const format    = searchParams.get('format')    || 'all'
  const category  = searchParams.get('category')  || 'all'
  const publisher = searchParams.get('publisher') || 'all'
  const sort      = searchParams.get('sort')      || 'relevance'

  // Region has local state for immediate button feedback; syncs from URL
  const [region, setRegion] = useState<'uk' | 'us'>(regionParam || 'uk')
  useEffect(() => { if (regionParam) setRegion(regionParam) }, [regionParam])

  const [results,    setResults]    = useState<ComicResult[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')
  const [didYouMean, setDidYouMean] = useState<string | null>(null)
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false)

  const currency = region === 'uk' ? '£' : '$'

  // Build a URL preserving all non-default params
  const buildUrl = (overrides: Record<string, string> = {}) => {
    const merged: Record<string, string> = { q: query, region, format, category, publisher, sort, ...overrides }
    const params = new URLSearchParams()
    Object.entries(merged).forEach(([k, v]) => {
      if (!v) return
      if (['format', 'category', 'publisher'].includes(k) && v === 'all') return
      if (k === 'sort' && v === 'relevance') return
      params.set(k, v)
    })
    return `/search?${params.toString()}`
  }

  const handleFilterChange = (key: string, value: string) =>
    router.push(buildUrl({ [key]: value }), { scroll: false })

  const clearFilters = () => {
    const params = new URLSearchParams({ q: query, region })
    if (sort !== 'relevance') params.set('sort', sort)
    router.push(`/search?${params.toString()}`, { scroll: false })
  }

  const switchRegion = (r: 'uk' | 'us') => {
    setRegion(r)
    router.push(buildUrl({ region: r }))
  }

  // Fetch when query changes
  useEffect(() => {
    if (!query) return
    setLoading(true)
    setError('')
    setResults([])
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

  // Spelling correction
  useEffect(() => {
    if (!query || loading) return
    fetch(`/api/autocomplete?q=${encodeURIComponent(query)}&mode=correct`)
      .then(r => r.json())
      .then(d => {
        if (d.correction && d.correction.toLowerCase() !== query.toLowerCase()) setDidYouMean(d.correction)
      })
      .catch(() => {})
  }, [query, loading])

  // Dynamic publisher list from fetched results
  const availablePublishers = useMemo(() => {
    const seen = new Set<string>()
    results.forEach(r => { if (r.publisher?.name) seen.add(r.publisher.name) })
    return Array.from(seen).sort()
  }, [results])

  // Client-side filter + sort — instant, no re-fetch
  const filteredResults = useMemo(() => {
    let res = [...results]
    if (format    !== 'all') res = res.filter(r => detectFormat(r)   === format)
    if (category  !== 'all') res = res.filter(r => detectCategory(r) === category)
    if (publisher !== 'all') res = res.filter(r => r.publisher?.name === publisher)
    if (sort === 'newest')   res.sort((a, b) => parseInt(b.start_year || '0') - parseInt(a.start_year || '0'))
    return res
  }, [results, format, category, publisher, sort])

  const hasActiveFilters = format !== 'all' || category !== 'all' || publisher !== 'all'

  const filterPanelProps: FilterPanelProps = {
    format, category, publisher,
    publishers: availablePublishers,
    currency,
    onChange: handleFilterChange,
    onClear: clearFilters,
  }

  return (
    <main className="min-h-screen font-sans" style={{ background: '#F8F8F6' }}>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <header style={{ background: '#fff', borderBottom: '1px solid #F0F0F0', position: 'sticky', top: 0, zIndex: 20 }}>
        <div className="max-w-6xl mx-auto px-8 h-20 flex items-center gap-4">
          <a href="/" className="shrink-0">
            <img src="/logo.png" alt="Catch Comics" className="h-12 w-auto" />
          </a>
          <div className="flex-1" style={{ maxWidth: '520px' }}>
            <SearchBar region={region} variant="header" initialQuery={query} />
          </div>
          <div className="flex items-center gap-3 ml-auto shrink-0">
            {(['uk', 'us'] as const).map(r => (
              <button key={r} onClick={() => switchRegion(r)}
                className="flex items-center gap-2.5 pl-2 pr-4 py-1.5 rounded-full border-2 transition-all"
                style={{ borderColor: region === r ? '#0A0A0A' : '#E5E7EB', background: region === r ? '#0A0A0A' : '#fff' }}>
                <span className="flex items-center justify-center rounded-full overflow-hidden shrink-0" style={{ width: '32px', height: '32px', background: '#f3f4f6' }}>
                  {r === 'uk' ? <UKFlag /> : <USFlag />}
                </span>
                <span className="text-sm font-medium" style={{ color: region === r ? '#fff' : '#6B7280' }}>
                  {r === 'uk' ? 'United Kingdom' : 'United States'}
                </span>
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── BODY ───────────────────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4 py-6" style={{ display: 'flex', gap: '28px', alignItems: 'flex-start' }}>

        {/* Sidebar — desktop only */}
        <aside className="hidden md:block" style={{
          width: '220px', flexShrink: 0, position: 'sticky', top: '96px',
          background: '#fff', borderRadius: '16px', padding: '20px',
          border: '1px solid #F0F0F0',
        }}>
          <FilterPanel {...filterPanelProps} />
        </aside>

        {/* Results column */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Top bar: count + mobile filter toggle + sort */}
          {!loading && !error && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <p style={{ fontSize: '13px', color: '#6B7280', margin: 0 }}>
                  <span style={{ fontWeight: 500, color: '#0A0A0A' }}>{filteredResults.length}</span>
                  {results.length !== filteredResults.length && (
                    <span style={{ color: '#9CA3AF' }}> of {results.length}</span>
                  )}{' '}
                  results for &ldquo;{query}&rdquo;
                </p>

                {/* Mobile filter button — hidden on desktop via Tailwind */}
                <button
                  onClick={() => setMobileFilterOpen(true)}
                  className="flex md:hidden items-center gap-1.5"
                  style={{
                    padding: '5px 12px', borderRadius: '999px', cursor: 'pointer',
                    border: `1px solid ${hasActiveFilters ? '#E8272A' : '#E5E7EB'}`,
                    background: hasActiveFilters ? '#FEF2F2' : '#fff',
                    color: hasActiveFilters ? '#E8272A' : '#6B7280',
                    fontSize: '12px', fontFamily: 'inherit',
                  }}>
                  <svg width="12" height="12" fill="none" viewBox="0 0 24 24">
                    <path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  Filters{hasActiveFilters ? ' ·' : ''}
                </button>
              </div>

              {/* Sort dropdown */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', color: '#9CA3AF' }}>Sort by</span>
                <select
                  value={sort}
                  onChange={e => handleFilterChange('sort', e.target.value)}
                  style={{
                    fontSize: '13px', color: '#0A0A0A', background: '#fff',
                    border: '1px solid #E5E7EB', borderRadius: '8px',
                    padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit', outline: 'none',
                  }}>
                  <option value="relevance">Relevance</option>
                  <option value="newest">Newest Release</option>
                </select>
              </div>
            </div>
          )}

          {/* Did you mean */}
          {didYouMean && !loading && (
            <div style={{ padding: '12px 16px', borderRadius: '12px', background: '#fff', border: '1px solid #F0F0F0', fontSize: '14px', color: '#6B7280', marginBottom: '16px' }}>
              Did you mean{' '}
              <button onClick={() => router.push(buildUrl({ q: didYouMean }))}
                style={{ fontWeight: 600, color: '#E8272A', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
                {didYouMean}
              </button>?
            </div>
          )}

          {/* Loading skeleton */}
          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[...Array(6)].map((_, i) => (
                <div key={i} className="animate-pulse" style={{ display: 'flex', gap: '14px', padding: '16px', borderRadius: '12px', border: '1px solid #F3F4F6', background: '#fff' }}>
                  <div style={{ width: '52px', height: '72px', borderRadius: '6px', background: '#F3F4F6', flexShrink: 0 }} />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '4px' }}>
                    <div style={{ height: '14px', borderRadius: '4px', width: '65%', background: '#F3F4F6' }} />
                    <div style={{ height: '12px', borderRadius: '4px', width: '42%', background: '#F3F4F6' }} />
                    <div style={{ height: '20px', borderRadius: '999px', width: '28%', background: '#F3F4F6', marginTop: '4px' }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {error && <div style={{ textAlign: 'center', padding: '64px 0', color: '#6B7280' }}>{error}</div>}

          {/* Result cards */}
          {!loading && !error && filteredResults.length > 0 && (
            <div style={{ borderTop: '1px solid #F0F0F0' }}>
              {filteredResults.map(comic => {
                const isIsbnResult = comic.source === 'open_library'
                const fmt = isIsbnResult ? 'graphic-novel' as Format : detectFormat(comic)
                const fmtStyle = FORMAT_STYLES[fmt]
                const isbn = comic.isbn13 || comic.isbn10 || ''
                const issueCount = comic.count_of_issues && comic.count_of_issues > 1 ? `${comic.count_of_issues} issues` : ''
                const meta = isIsbnResult
                  ? [comic.authors?.join(', '), comic.start_year].filter(Boolean).join(' · ')
                  : [comic.publisher?.name, comic.start_year, issueCount].filter(Boolean).join(' · ')

                return (
                  <div
                    key={comic.id}
                    onClick={() => router.push(`/comic/${comic.id}?region=${region}`)}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', padding: '16px 0', cursor: 'pointer', borderBottom: '1px solid #F0F0F0' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#FAFAFA')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>

                    {/* Cover image — letter always rendered as background fallback;
                        image overlays it and hides itself via onError if it fails */}
                    <div style={{ width: '52px', height: '72px', borderRadius: '6px', overflow: 'hidden', background: '#F3F4F6', border: '1px solid #EBEBEB', flexShrink: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ color: '#9CA3AF', fontSize: '18px', fontWeight: 500, position: 'absolute' }}>
                        {comic.name.charAt(0)}
                      </span>
                      {comic.image?.medium_url && (
                        <img
                          src={comic.image.medium_url}
                          alt={comic.name}
                          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                        />
                      )}
                    </div>

                    {/* Metadata */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h2 style={{ fontSize: '14px', fontWeight: 600, color: '#0A0A0A', margin: '0 0 3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {comic.name}
                      </h2>

                      {meta && (
                        <p style={{ fontSize: '12px', color: '#9CA3AF', margin: '0 0 7px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {meta}
                        </p>
                      )}

                      {/* Format badge */}
                      <span style={{
                        display: 'inline-block', fontSize: '10px', fontWeight: 600,
                        padding: '2px 8px', borderRadius: '999px',
                        background: isIsbnResult ? '#F3F4F6' : fmtStyle.bg,
                        color: isIsbnResult ? '#6B7280' : fmtStyle.color,
                      }}>
                        {isIsbnResult ? 'ISBN Match' : FORMAT_LABELS[fmt]}
                      </span>

                      {/* ISBN — subtle, grey, monospace */}
                      {isbn && (
                        <p style={{ fontSize: '11px', color: '#C9C9C9', margin: '5px 0 0', fontFamily: 'monospace', letterSpacing: '0.03em' }}>
                          ISBN {isbn}
                        </p>
                      )}
                    </div>

                    {/* Region-aware CTA */}
                    <div style={{ flexShrink: 0, textAlign: 'right', paddingTop: '2px' }}>
                      <div style={{ fontSize: '10px', color: '#9CA3AF', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '2px' }}>Compare</div>
                      <div style={{ fontSize: '13px', fontWeight: 500, color: '#E8272A' }}>Find prices →</div>
                      <div style={{ fontSize: '10px', color: '#9CA3AF', marginTop: '2px' }}>
                        {region === 'uk' ? 'UK stores' : 'US stores'}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Filters removed all results */}
          {!loading && !error && results.length > 0 && filteredResults.length === 0 && (
            <div style={{ textAlign: 'center', padding: '64px 0' }}>
              <p style={{ fontWeight: 500, color: '#0A0A0A', marginBottom: '8px', fontSize: '15px' }}>
                No results match your filters
              </p>
              <button onClick={clearFilters} style={{ fontSize: '13px', color: '#E8272A', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}>
                Clear filters
              </button>
            </div>
          )}

          {/* Zero results from API */}
          {!loading && !error && results.length === 0 && (
            <div style={{ textAlign: 'center', padding: '64px 0' }}>
              <p style={{ fontWeight: 500, color: '#0A0A0A', marginBottom: '8px', fontSize: '15px' }}>
                No results for &ldquo;{query}&rdquo;
              </p>
              <p style={{ fontSize: '14px', color: '#6B7280' }}>Try searching by series name, character, or publisher</p>
            </div>
          )}

        </div>{/* end results column */}
      </div>{/* end body */}

      {/* ── MOBILE FILTER DRAWER ───────────────────────────────────────────── */}
      {mobileFilterOpen && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setMobileFilterOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 40 }}
          />
          {/* Slide-in panel */}
          <div style={{
            position: 'fixed', right: 0, top: 0, bottom: 0,
            width: '300px', maxWidth: '90vw',
            background: '#fff', zIndex: 50, overflowY: 'auto',
            padding: '24px', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <span style={{ fontSize: '16px', fontWeight: 600, color: '#0A0A0A' }}>Filters</span>
              <button
                onClick={() => setMobileFilterOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', fontSize: '20px', lineHeight: 1 }}>
                ✕
              </button>
            </div>
            <FilterPanel
              {...filterPanelProps}
              onChange={(key, value) => { handleFilterChange(key, value); setMobileFilterOpen(false) }}
              onClear={() => { clearFilters(); setMobileFilterOpen(false) }}
            />
          </div>
        </>
      )}

    </main>
  )
}

// ─── Page export with Suspense boundary ──────────────────────────────────────

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8F8F6', fontFamily: 'sans-serif' }}>
        <p style={{ color: '#9CA3AF', fontSize: '14px' }}>Loading...</p>
      </div>
    }>
      <SearchResults />
    </Suspense>
  )
}
