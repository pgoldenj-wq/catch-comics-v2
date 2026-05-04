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

// Validated set used by URL parsing — anything outside this list falls back to 'all'.
const VALID_FORMATS: string[] = [
  'all', 'single-issue', 'graphic-novel', 'hardcover', 'omnibus', 'manga', 'compact', 'one-shot',
]

// Top-pill umbrellas. Each user-facing pill maps to multiple internal format
// IDs because detectFormat() uses heuristics on inconsistent data. Without
// this grouping, picking "Graphic Novels" excludes anything tagged 'hardcover'
// (e.g. "Absolute Batman" — name contains "absolute" → hardcover) even though
// users clearly expect those to appear under Graphic Novels.
const FORMAT_FILTER_GROUPS: Record<string, Format[]> = {
  'graphic-novel': ['graphic-novel', 'hardcover', 'omnibus', 'compact', 'one-shot'],
  'single-issue': ['single-issue'],
  'manga':         ['manga'],
}

// ─── Format / Category Detection ─────────────────────────────────────────────

const MANGA_PUBLISHERS = ['viz', 'kodansha', 'yen press', 'seven seas', 'tokyopop', 'square enix', 'shonen jump', 'dark horse manga', 'j-novel', 'vertical']
const INDIE_PUBLISHERS  = ['image', 'boom', 'dark horse', 'fantagraphics', 'oni press', 'dynamite', 'aftershock', 'vault', 'idw', 'drawn & quarterly', 'top shelf']

function detectFormat(comic: ComicResult): Format {
  const name = (comic.name || '').toLowerCase()
  const pub  = (comic.publisher?.name || '').toLowerCase()
  // BUG FIX: manga publisher must beat the cv_issue check below — without this,
  // a manga single issue (e.g. a Chainsaw Man chapter from Viz) classifies as
  // 'single-issue' and disappears when the user filters by Manga.
  if (MANGA_PUBLISHERS.some(p => pub.includes(p))) return 'manga'
  // Comic Vine issue records — single issue when not from a manga publisher.
  if (comic.source === 'cv_issue') return 'single-issue'
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

// 5-point star polygon centred at (0,0) with outer radius 1.2, inner 0.46.
// Drawn once and translated per-star — the proper iconic US-flag look.
const STAR_5_POINTS = "0,-1.2 0.27,-0.37 1.14,-0.37 0.44,0.14 0.71,0.97 0,0.46 -0.71,0.97 -0.44,0.14 -1.14,-0.37 -0.27,-0.37"

function USFlag() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30" preserveAspectRatio="xMinYMid slice" style={{ width: '100%', height: '100%', display: 'block' }} aria-label="US flag">
      <rect width="60" height="30" fill="#B22234"/>
      <path d="M0 3.46h60M0 6.92h60M0 10.38h60M0 13.85h60M0 17.31h60M0 20.77h60M0 24.23h60" stroke="#fff" strokeWidth="2.31"/>
      <rect width="24" height="16.15" fill="#3C3B6E"/>
      <g fill="#fff">{[...Array(5)].map((_, row) => [...Array(row % 2 === 0 ? 6 : 5)].map((_, col) => {
        const cx = row % 2 === 0 ? 2 + col * 4 : 4 + col * 4
        const cy = 2 + row * 3
        return <polygon key={`${row}-${col}`} points={STAR_5_POINTS} transform={`translate(${cx} ${cy})`} />
      }))}</g>
    </svg>
  )
}

// ─── Filter Panel ─────────────────────────────────────────────────────────────

interface FilterPanelProps {
  category:  string
  publisher: string
  publishers: string[]
  priceMax:  string         // 'all' | '5' | '10' | '15' | '25' | '35' | '50'
  currency:  string
  onChange:  (key: string, value: string) => void
  onClear:   () => void
}

function FilterPanel({ category, publisher, publishers, priceMax, currency, onChange, onClear }: FilterPanelProps) {
  // Default: only Price Range open. Other sections collapse so the sidebar
  // reads as a small, focused widget on first load.
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['price']))

  const toggleSection = (id: string) => setOpenSections(prev => {
    const s = new Set(prev)
    s.has(id) ? s.delete(id) : s.add(id)
    return s
  })

  const hasActive = category !== 'all' || publisher !== 'all' || priceMax !== 'all'

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

      {/* FORMAT — moved to top filter row (multi-select pills above results) */}

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

      {/* PRICE RANGE — region-aware "Under £X / Under $X" thresholds.
          Filter logic in SearchResults treats results without a price as a
          pass-through, so this is effectively a no-op until /api/prices
          populates a `price` field on individual results. */}
      <div style={{ borderTop: '1px solid #F0F0F0' }}>
        {sectionHeader('price', `Price Range (${currency})`)}
        {openSections.has('price') && (
          <div style={{ paddingBottom: '14px' }}>
            {([
              ['all', 'All prices'],
              ['5',   `Under ${currency}5`],
              ['10',  `Under ${currency}10`],
              ['15',  `Under ${currency}15`],
              ['25',  `Under ${currency}25`],
              ['35',  `Under ${currency}35`],
              ['50',  `Under ${currency}50`],
            ] as [string, string][]).map(([v, l]) => radioOption('priceMax', v, priceMax, l))}
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
  const query       = searchParams.get('q') || ''
  const regionParam = searchParams.get('region') as 'uk' | 'us' | null
  // SINGLE-SELECT format. Backwards-compat: if URL still has a comma-separated
  // value from the old multi-select system, take the first segment. Anything
  // we don't recognise falls back to 'all' — prevents stale URLs producing zero results.
  const formatRaw       = searchParams.get('format') || 'all'
  const formatCandidate = formatRaw.split(',')[0]
  const format          = VALID_FORMATS.includes(formatCandidate) ? formatCandidate : 'all'
  const category        = searchParams.get('category')  || 'all'
  const publisher       = searchParams.get('publisher') || 'all'
  const priceMax        = searchParams.get('priceMax')  || 'all'
  const sort            = searchParams.get('sort')      || 'relevance'

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
    const merged: Record<string, string> = {
      q: query, region,
      format,                        // single-select string
      category, publisher, priceMax, sort,
      ...overrides,
    }
    const params = new URLSearchParams()
    Object.entries(merged).forEach(([k, v]) => {
      if (!v) return
      if (['format', 'category', 'publisher', 'priceMax'].includes(k) && v === 'all') return
      if (k === 'sort' && v === 'relevance') return
      params.set(k, v)
    })
    return `/search?${params.toString()}`
  }

  const handleFilterChange = (key: string, value: string) =>
    router.push(buildUrl({ [key]: value }), { scroll: false })

  // Single-select format setter — clicking the active pill clears to 'all'.
  const setFormatFilter = (id: string) => {
    const next = id === format ? 'all' : id
    router.push(buildUrl({ format: next }), { scroll: false })
  }

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
    if (format !== 'all') {
      // Use the umbrella group so heuristic-classified results (hardcover,
      // omnibus, etc.) still match the user's chosen pill. Falls back to
      // strict equality for unknown format ids.
      const allowed = FORMAT_FILTER_GROUPS[format] || [format as Format]
      res = res.filter(r => allowed.includes(detectFormat(r)))
    }
    if (category  !== 'all') res = res.filter(r => detectCategory(r) === category)
    if (publisher !== 'all') res = res.filter(r => r.publisher?.name === publisher)
    if (priceMax  !== 'all') {
      const max = parseFloat(priceMax)
      if (!isNaN(max)) {
        res = res.filter(r => {
          // Activates once results carry a `price.value` (eBay integration to follow);
          // until then this is a pass-through so the UI state is preserved without
          // hiding all results.
          const price = (r as { price?: { value?: number } }).price?.value
          return price == null || price < max
        })
      }
    }
    if (sort === 'newest')   res.sort((a, b) => parseInt(b.start_year || '0') - parseInt(a.start_year || '0'))
    return res
  }, [results, format, category, publisher, priceMax, sort])

  const hasActiveFilters = format !== 'all' || category !== 'all' || publisher !== 'all' || priceMax !== 'all'

  const filterPanelProps: FilterPanelProps = {
    category, publisher,
    publishers: availablePublishers,
    priceMax,
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

        {/* Sidebar — desktop only.
            maxHeight + overflowY makes the sidebar scroll independently when its
            content exceeds the viewport (e.g. lots of publishers). overscrollBehavior
            stops scroll-chaining into the page so the body doesn't jump. */}
        <aside className="hidden md:block" style={{
          width: '220px', flexShrink: 0, position: 'sticky', top: '96px',
          maxHeight: 'calc(100vh - 96px - 24px)',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          background: '#fff', borderRadius: '16px', padding: '20px',
          border: '1px solid #F0F0F0',
        }}>
          <FilterPanel {...filterPanelProps} />
        </aside>

        {/* Results column */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* TOP FILTER ROW — single-select format pills + result count.
              Clicking the active pill clears back to 'all'. */}
          {!loading && !error && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              {([
                { id: 'all',           label: 'All' },
                { id: 'graphic-novel', label: 'Graphic Novels' },
                { id: 'single-issue', label: 'Single Issues' },
                { id: 'manga',         label: 'Manga' },
              ] as { id: string; label: string }[]).map(({ id, label }) => {
                const active = id === format
                return (
                  <button
                    key={id}
                    onClick={() => setFormatFilter(id)}
                    aria-pressed={active}
                    style={{
                      padding: '7px 14px',
                      borderRadius: '999px',
                      fontSize: '13px',
                      fontWeight: 500,
                      fontFamily: 'inherit',
                      cursor: 'pointer',
                      background:  active ? '#0A0A0A' : '#fff',
                      color:       active ? '#fff'    : '#374151',
                      border:      `1px solid ${active ? '#0A0A0A' : '#E5E7EB'}`,
                      transition:  'background 0.12s, color 0.12s, border-color 0.12s',
                      whiteSpace:  'nowrap',
                    }}>
                    {label}
                  </button>
                )
              })}
              <p style={{ fontSize: '13px', color: '#6B7280', margin: 0, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                <span style={{ fontWeight: 500, color: '#0A0A0A' }}>{filteredResults.length}</span>
                {results.length !== filteredResults.length && (
                  <span style={{ color: '#9CA3AF' }}> of {results.length}</span>
                )}{' '}
                {filteredResults.length === 1 ? 'result' : 'results'} for &ldquo;{query}&rdquo;
              </p>
            </div>
          )}

          {/* SECONDARY ROW — mobile filter button + sort dropdown */}
          {!loading && !error && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
                  <div style={{ width: '80px', height: '112px', borderRadius: '6px', background: '#F3F4F6', flexShrink: 0 }} />
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
                    className="group"
                    style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', padding: '16px 0', cursor: 'pointer', borderBottom: '1px solid #F0F0F0' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#FAFAFA')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>

                    {/* Cover image — letter always rendered as background fallback;
                        image overlays it and hides itself via onError if it fails.
                        overflow:hidden contains the hover zoom on the <img>. */}
                    <div style={{ width: '80px', height: '112px', borderRadius: '6px', overflow: 'hidden', background: '#F3F4F6', border: '1px solid #EBEBEB', flexShrink: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ color: '#9CA3AF', fontSize: '26px', fontWeight: 500, position: 'absolute' }}>
                        {comic.name.charAt(0)}
                      </span>
                      {comic.image?.medium_url && (
                        <img
                          src={comic.image.medium_url}
                          alt={comic.name}
                          className="transition-transform duration-300 ease-out group-hover:scale-105"
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
