'use client'
// ⚠ DESIGN FREEZE — do not change layout, spacing, colours, or typography without explicit instruction

import { useEffect, useState, useRef, Suspense } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import PricingPanel, { type PriceSnapshot } from '@/components/PricingPanel'
import SearchBar from '@/components/SearchBar'
import MobileHeader from '@/components/MobileHeader'

interface ComicDetail {
  id: number
  name: string
  image: { medium_url: string; original_url: string }
  start_year: string
  publisher: { name: string }
  description: string
  count_of_issues: number
  people?: Array<{ name: string; role: string; id: number }>
  characters?: Array<{ name: string; id: number }>
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
  // Detail-page listing filters
  const [formatFilter, setFormatFilter] = useState<'all' | 'graphic-novel' | 'single-issue' | 'manga'>('all')
  const [priceMax, setPriceMax]         = useState<'all' | '5' | '10' | '15' | '25' | '35' | '50'>('all')
  const [condition, setCondition]       = useState<'all' | 'new' | 'used'>('all')
  // Both Condition and Price Range open by default
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['condition', 'price']))
  // Mobile filter drawer (mirrors search page pattern)
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false)
  const toggleSection = (id: string) => setOpenSections(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s
  })

  // Price intelligence panel — undefined = loading, null = no listings, snapshot = live data
  const [priceSummary, setPriceSummary] = useState<PriceSnapshot | null | undefined>(undefined)
  const listingsRef = useRef<HTMLDivElement>(null)

  // Reset snapshot whenever the region changes so stale data isn't shown
  useEffect(() => { setPriceSummary(undefined) }, [market])

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
      <style>{`
        @keyframes price-pulse {
          0%, 100% { opacity: 1;   transform: scale(1);    }
          50%       { opacity: 0.4; transform: scale(0.75); }
        }
        .price-pulse-dot { animation: price-pulse 1.8s ease-in-out infinite; }
      `}</style>

      {/* NAV — mobile (shared component) + desktop (frozen) */}
      <MobileHeader
        variant="search"
        region={market}
        onRegionChange={setMarket}
        initialQuery={comic?.name ?? ''}
      />
      <div className="hidden md:block">
        <nav className="sticky top-0 z-20 bg-white border-b border-gray-100 px-8 h-20 flex items-center gap-4">
          <a href="/" className="shrink-0">
            <img src="/logo.png" alt="Catch Comics" className="h-12 w-auto" />
          </a>
          <div className="flex-1" style={{ maxWidth: '480px' }}>
            <SearchBar region={market} variant="header" initialQuery={comic?.name ?? ''} />
          </div>
        </nav>
      </div>

      {/* DARK HEADER — 2-column: LEFT = back + cover | RIGHT = title + metadata + price + region */}
      <div className="relative bg-[#111827]">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
          }}
        />
        <div className="relative max-w-5xl mx-auto px-6 py-4" style={{ display: 'grid', gridTemplateColumns: '132px 1fr', gap: '24px', alignItems: 'start' }}>

          {/* ── LEFT COLUMN: back nav + cover ── */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>

            {/* Back nav */}
            <button
              onClick={() => router.back()}
              aria-label="Back to previous page"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                fontSize: '11px', color: 'rgba(255,255,255,0.4)',
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '4px 0', fontFamily: 'inherit', minHeight: '36px',
                transition: 'color 0.12s', alignSelf: 'flex-start',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.85)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.4)')}
            >
              <svg width="12" height="12" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Back
            </button>

            {/* Cover — w-[132px] h-[198px] exact 2:3 ratio */}
            <div
              className="relative rounded-lg border border-white/10 shadow-xl bg-white/5 flex items-center justify-center transition-transform duration-300 ease-out hover:scale-[2] hover:z-50"
              style={{ width: '132px', height: '198px', marginTop: '6px', flexShrink: 0 }}
            >
              <span className="text-white/30 text-3xl font-medium absolute">{comic.name.charAt(0)}</span>
              {comic.image?.medium_url && (
                <img
                  src={comic.image.medium_url}
                  alt={comic.name}
                  className="absolute inset-0 w-full h-full object-cover rounded-lg"
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                />
              )}
            </div>
          </div>

          {/* ── RIGHT COLUMN: eyebrow → title → type → creators → price → chars → region ── */}
          {(() => {
            const people = comic.people || []
            const roleMatch = (role: string | null | undefined, kw: string) => (role ?? '').toLowerCase().includes(kw)
            const writers      = [...new Set(people.filter(p => roleMatch(p.role, 'writer')).map(p => p.name))]
            const pencilers    = [...new Set(people.filter(p =>
              roleMatch(p.role, 'pencil') ||
              roleMatch(p.role, 'inker') ||
              (roleMatch(p.role, 'artist') && !roleMatch(p.role, 'cover'))
            ).map(p => p.name))]
            const colourists   = [...new Set(people.filter(p => roleMatch(p.role, 'colour') || roleMatch(p.role, 'color')).map(p => p.name))]
            const coverArtists = [...new Set(people.filter(p => roleMatch(p.role, 'cover')).map(p => p.name))]
            const chars        = comic.characters || []

            // Creator name links — up to `limit` names, then "+X" count
            const renderNames = (names: string[], limit = 3) => {
              const visible  = names.slice(0, limit)
              const overflow = names.length - limit
              return (
                <>
                  {visible.map((name, i, arr) => (
                    <span key={name}>
                      <a
                        href={`/search?q=${encodeURIComponent(name)}&region=${market}`}
                        style={{ color: '#fff', textDecoration: 'none', cursor: 'pointer', transition: 'opacity 0.12s' }}
                        onMouseEnter={e => (e.currentTarget.style.opacity = '0.6')}
                        onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
                      >
                        {name}
                      </a>
                      {i < arr.length - 1 ? ', ' : ''}
                    </span>
                  ))}
                  {overflow > 0 && (
                    <span style={{ color: 'rgba(255,255,255,0.3)', marginLeft: '3px' }}>+{overflow}</span>
                  )}
                </>
              )
            }

            // Creator rows — only roles with data
            const creatorRows: { label: string; names: string[] }[] = []
            if (writers.length)      creatorRows.push({ label: 'Writer',  names: writers })
            if (pencilers.length)    creatorRows.push({ label: 'Artist',  names: pencilers })
            if (colourists.length)   creatorRows.push({ label: 'Colours', names: colourists })
            if (coverArtists.length) creatorRows.push({ label: 'Cover',   names: coverArtists })

            // Eyebrow: publisher + year only — issues count goes in the type subtitle
            const eyebrowParts: string[] = []
            if (comic.publisher?.name) eyebrowParts.push(comic.publisher.name)
            if (comic.start_year)      eyebrowParts.push(isVolume ? `Est. ${comic.start_year}` : comic.start_year)

            const CHAR_VISIBLE = 6
            const visibleChars = chars.slice(0, CHAR_VISIBLE)
            const charOverflow = chars.length - CHAR_VISIBLE

            // Currency symbol from live data, fallback to region
            const currSym = priceSummary?.currency === 'GBP' ? '£'
                          : priceSummary?.currency === 'USD' ? '$'
                          : (market === 'uk' ? '£' : '$')
            const mktLabel = market === 'uk' ? 'UK' : 'US'

            // Scroll to listings keeping the format-filter tabs visible below the sticky nav.
            // 80px nav + 8px breathing room = 88px offset from viewport top.
            const scrollToListings = () => {
              const el = listingsRef.current
              if (!el) return
              const top = el.getBoundingClientRect().top + window.scrollY - 88
              window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
            }

            return (
              <div style={{ paddingTop: '36px', display: 'flex', flexDirection: 'column', gap: '8px' }}>

                {/* ── EYEBROW — publisher · Est. year ─────────────────────────── */}
                {eyebrowParts.length > 0 && (
                  <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.38)', margin: 0, letterSpacing: '0.01em' }}>
                    {eyebrowParts.join(' · ')}
                  </p>
                )}

                {/* ── TITLE — dominant, editorial ──────────────────────────────── */}
                <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#fff', lineHeight: 1.2, letterSpacing: '-0.02em', margin: 0 }}>
                  {comic.name}
                </h1>

                {/* ── TYPE + ISSUES — subtitle ─────────────────────────────────── */}
                <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', margin: 0 }}>
                  {/^i\d+$/.test(id) ? 'Single Issue' : 'Comic Series'}
                  {!isNaN(comic.count_of_issues) && comic.count_of_issues > 0
                    ? ` · ${comic.count_of_issues} issues` : ''}
                </p>

                {/* ── CREATORS — Letterboxd-style hierarchy ────────────────────── */}
                {creatorRows.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                    {creatorRows.map(({ label, names }) => (
                      <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                        <span style={{
                          fontSize: '10px', fontWeight: 700, letterSpacing: '0.09em',
                          textTransform: 'uppercase', color: 'rgba(255,255,255,0.28)',
                          minWidth: '52px', flexShrink: 0,
                        }}>
                          {label}
                        </span>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#fff', lineHeight: 1.35 }}>
                          {renderNames(names)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── PRICE STRIP — inline, no card ─────────────────────────────── */}
                <div style={{ marginTop: '6px' }}>

                  {/* Loading */}
                  {priceSummary === undefined && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="price-pulse-dot" style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#E8272A', flexShrink: 0 }} />
                      <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.03em' }}>
                        eBay {mktLabel} · Fetching prices…
                      </span>
                    </div>
                  )}

                  {/* No listings */}
                  {priceSummary === null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'rgba(255,255,255,0.15)', flexShrink: 0 }} />
                      <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.25)' }}>
                        No eBay listings right now
                      </span>
                    </div>
                  )}

                  {/* Live data */}
                  {priceSummary != null && priceSummary !== undefined && (
                    <>
                      {/* Row 1 — dot · source · price · CTA */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span className="price-pulse-dot" style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#E8272A', flexShrink: 0 }} />
                          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.38)', letterSpacing: '0.03em' }}>
                            eBay {mktLabel}
                          </span>
                        </div>
                        <span style={{ fontSize: '26px', fontWeight: 800, color: '#E8272A', letterSpacing: '-0.025em', lineHeight: 1 }}>
                          {currSym}{priceSummary.bestPrice.toFixed(2)}
                        </span>
                        <button
                          onClick={scrollToListings}
                          style={{
                            display: 'inline-flex', alignItems: 'center',
                            background: '#fff', color: '#0A0A0A',
                            fontSize: '12px', fontWeight: 700,
                            padding: '7px 14px', borderRadius: '999px',
                            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                            transition: 'background 0.15s, color 0.15s',
                            whiteSpace: 'nowrap',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = '#E8272A'; e.currentTarget.style.color = '#fff' }}
                          onMouseLeave={e => { e.currentTarget.style.background = '#fff';    e.currentTarget.style.color = '#0A0A0A' }}
                        >
                          View best deal →
                        </button>
                      </div>
                      {/* Row 2 — offer count + condition breakdown */}
                      <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.33)', margin: '4px 0 0', lineHeight: 1.4 }}>
                        {priceSummary.totalOffers} {priceSummary.totalOffers === 1 ? 'offer' : 'offers'}
                        {priceSummary.newFrom  !== null ? ` · New from ${currSym}${priceSummary.newFrom.toFixed(2)}`  : ''}
                        {priceSummary.usedFrom !== null ? ` · Used from ${currSym}${priceSummary.usedFrom.toFixed(2)}` : ''}
                      </p>
                    </>
                  )}
                </div>

                {/* ── CHARACTERS — pill tags ─────────────────────────────────────── */}
                {chars.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '2px' }}>
                    {visibleChars.map(c => (
                      <a
                        key={c.id}
                        href={`/search?q=${encodeURIComponent(c.name)}&region=${market}`}
                        aria-label={`Search comics featuring ${c.name}`}
                        style={{
                          display: 'inline-block', fontSize: '11px', fontWeight: 500,
                          padding: '3px 8px', borderRadius: '999px',
                          background: 'rgba(255,255,255,0.07)',
                          color: 'rgba(255,255,255,0.6)',
                          textDecoration: 'none',
                          border: '1px solid rgba(255,255,255,0.1)',
                          transition: 'background 0.12s, color 0.12s',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; e.currentTarget.style.color = '#fff' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.07)';  e.currentTarget.style.color = 'rgba(255,255,255,0.6)' }}
                      >
                        {c.name}
                      </a>
                    ))}
                    {charOverflow > 0 && (
                      <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.25)', alignSelf: 'center' }}>
                        +{charOverflow} more
                      </span>
                    )}
                  </div>
                )}

                {/* ── REGION TOGGLE — "Prices for: GB UK  us US" ─────────────────── */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.01em' }}>
                    Prices for:
                  </span>
                  {(['uk', 'us'] as const).map(r => (
                    <button
                      key={r}
                      onClick={() => setMarket(r)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '5px',
                        padding: '4px 10px', borderRadius: '999px',
                        fontSize: '11px', fontWeight: 500, fontFamily: 'inherit',
                        border: `1px solid ${market === r ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)'}`,
                        background: market === r ? 'rgba(255,255,255,0.1)' : 'transparent',
                        color: market === r ? '#fff' : 'rgba(255,255,255,0.35)',
                        cursor: 'pointer', transition: 'all 0.12s',
                      }}
                    >
                      {r === 'uk' ? '🇬🇧 UK' : '🇺🇸 US'}
                    </button>
                  ))}
                </div>

              </div>
            )
          })()}
        </div>
      </div>

      {/* ── BODY: three columns — filter sidebar | pricing | issues ─────────── */}
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-6" style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>

        {/* ── FILTER SIDEBAR — desktop only ───────────────────────────────────
            Hidden on mobile (md:hidden → hidden md:block). Mobile uses the
            slide-in drawer below (same pattern as search page). */}
        <aside className="hidden md:block" style={{
          width: '188px', flexShrink: 0,
          position: 'sticky', top: '96px',
          maxHeight: 'calc(100vh - 96px - 24px)', overflowY: 'auto',
          overscrollBehavior: 'contain',
          background: '#fff', borderRadius: '16px',
          padding: '18px', border: '1px solid #F0F0F0',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#0A0A0A' }}>Filters</span>
            {(priceMax !== 'all' || condition !== 'all' || formatFilter !== 'all') && (
              <button
                onClick={() => { setPriceMax('all'); setCondition('all'); setFormatFilter('all') }}
                style={{ fontSize: '11px', color: '#C41F22', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
              >
                Clear
              </button>
            )}
          </div>

          {/* CONDITION — first, open by default */}
          <div style={{ borderTop: '1px solid #EBEBEB' }}>
            <button
              onClick={() => toggleSection('condition')}
              aria-expanded={openSections.has('condition')}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                padding: '12px 0', fontSize: '11px', fontWeight: 700,
                letterSpacing: '0.08em', textTransform: 'uppercase', color: '#374151',
                fontFamily: 'inherit',
              }}>
              Condition
              <span aria-hidden="true" style={{ fontSize: '9px', display: 'inline-block', transition: 'transform 0.15s', transform: openSections.has('condition') ? 'rotate(180deg)' : 'none' }}>▼</span>
            </button>
            {openSections.has('condition') && (
              <div style={{ paddingBottom: '16px' }}>
                {([
                  ['all',  'All conditions'],
                  ['new',  'New'],
                  ['used', 'Used'],
                ] as [string, string][]).map(([val, label]) => {
                  const active = condition === val
                  return (
                    <button key={val} onClick={() => setCondition(val as typeof condition)}
                      style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0', textAlign: 'left', fontFamily: 'inherit' }}>
                      <span style={{ width: '16px', height: '16px', borderRadius: '50%', flexShrink: 0, border: `2px solid ${active ? '#E8272A' : '#D1D5DB'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
                        {active && <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#E8272A', display: 'block' }} />}
                      </span>
                      <span style={{ fontSize: '14px', color: active ? '#0A0A0A' : '#4B5563', fontWeight: active ? 600 : 400 }}>{label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* PRICE RANGE — second */}
          <div style={{ borderTop: '1px solid #EBEBEB' }}>
            <button
              onClick={() => toggleSection('price')}
              aria-expanded={openSections.has('price')}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                padding: '12px 0', fontSize: '11px', fontWeight: 700,
                letterSpacing: '0.08em', textTransform: 'uppercase', color: '#374151',
                fontFamily: 'inherit',
              }}>
              Price Range
              <span aria-hidden="true" style={{ fontSize: '9px', display: 'inline-block', transition: 'transform 0.15s', transform: openSections.has('price') ? 'rotate(180deg)' : 'none' }}>▼</span>
            </button>
            {openSections.has('price') && (
              <div style={{ paddingBottom: '16px' }}>
                {([
                  ['all', 'All prices'],
                  ['5',   `Under ${market === 'uk' ? '£' : '$'}5`],
                  ['10',  `Under ${market === 'uk' ? '£' : '$'}10`],
                  ['15',  `Under ${market === 'uk' ? '£' : '$'}15`],
                  ['25',  `Under ${market === 'uk' ? '£' : '$'}25`],
                  ['35',  `Under ${market === 'uk' ? '£' : '$'}35`],
                  ['50',  `Under ${market === 'uk' ? '£' : '$'}50`],
                ] as [string, string][]).map(([val, label]) => {
                  const active = priceMax === val
                  return (
                    <button key={val} onClick={() => setPriceMax(val as typeof priceMax)}
                      style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0', textAlign: 'left', fontFamily: 'inherit' }}>
                      <span style={{ width: '16px', height: '16px', borderRadius: '50%', flexShrink: 0, border: `2px solid ${active ? '#E8272A' : '#D1D5DB'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
                        {active && <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#E8272A', display: 'block' }} />}
                      </span>
                      <span style={{ fontSize: '14px', color: active ? '#0A0A0A' : '#4B5563', fontWeight: active ? 600 : 400 }}>{label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </aside>

        {/* ── PRICING (centre) ────────────────────────────────────────────────── */}
        <div ref={listingsRef} style={{ flex: 1, minWidth: 0 }}>

          {/* Mobile filter button — same pattern as search page (md:hidden) */}
          {(priceMax !== 'all' || condition !== 'all' || formatFilter !== 'all')
            ? (
              <button
                onClick={() => setMobileFilterOpen(true)}
                className="flex md:hidden"
                style={{
                  height: '36px', padding: '0 14px', borderRadius: '999px', cursor: 'pointer',
                  border: '1px solid #E8272A', background: '#FEF2F2', color: '#E8272A',
                  fontSize: '13px', fontFamily: 'inherit', marginBottom: '12px',
                  alignItems: 'center', gap: '6px',
                }}>
                <svg width="13" height="13" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                Filters ·
              </button>
            ) : (
              <button
                onClick={() => setMobileFilterOpen(true)}
                className="flex md:hidden"
                style={{
                  height: '36px', padding: '0 14px', borderRadius: '999px', cursor: 'pointer',
                  border: '1px solid #E5E7EB', background: '#fff', color: '#6B7280',
                  fontSize: '13px', fontFamily: 'inherit', marginBottom: '12px',
                  alignItems: 'center', gap: '6px',
                }}>
                <svg width="13" height="13" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                Filters
              </button>
            )
          }

          {/* ── DESCRIPTION — rendered only when Comic Vine returns one ────── */}
          {comic.description && comic.description.trim() && (
            <div style={{ marginBottom: '24px' }}>
              <h2 style={{ fontSize: '13px', fontWeight: 600, color: '#111827', marginBottom: '8px', letterSpacing: '0.01em' }}>
                About
              </h2>
              <p style={{ fontSize: '14px', color: '#374151', lineHeight: 1.65, margin: 0 }}>
                {comic.description
                  .replace(/<[^>]+>/g, ' ')         /* strip HTML tags */
                  .replace(/&amp;/g, '&')
                  .replace(/&lt;/g, '<')
                  .replace(/&gt;/g, '>')
                  .replace(/&quot;/g, '"')
                  .replace(/&#39;/g, "'")
                  .replace(/&nbsp;/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim()}
              </p>
            </div>
          )}

          <PricingPanel
            query={comic.name}
            region={market}
            formatFilter={formatFilter}
            onFormatChange={setFormatFilter}
            priceMax={priceMax}
            condition={condition}
            onPriceSnapshot={setPriceSummary}
          />
          <p className="text-xs text-gray-400 mt-8 leading-relaxed">
            Catch Comics links to third-party retailers. Prices and availability may vary.
          </p>
        </div>

        {/* ── ISSUES GRID (right, volumes only, desktop only) ─────────────────
            Hidden on mobile — issues appear below pricing in the mobile layout. */}
        {isVolume && (issuesLoading || issues.length > 0) && (
          <div className="hidden md:block" style={{ width: '216px', flexShrink: 0, position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '10px' }}>
              <h2 style={{ fontSize: '13px', fontWeight: 600, color: '#111827', margin: 0 }}>Issues in this series</h2>
              {!issuesLoading && issues.length > 0 && (
                <span style={{ fontSize: '11px', color: '#9CA3AF' }}>{issues.length}</span>
              )}
            </div>

            {issuesLoading ? (
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="animate-pulse">
                    <div className="rounded-md bg-gray-100" style={{ aspectRatio: '2 / 3' }} />
                    <div className="h-2.5 bg-gray-100 rounded mt-1.5 w-1/2" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                {issues.map(issue => {
                  const cover = issue.image.medium_url || issue.image.small_url
                  const label = issue.issue_number ? `#${issue.issue_number}` : (issue.name || 'Issue')
                  const sub   = issue.cover_year || ''
                  return (
                    <button
                      key={issue.id}
                      onClick={() => router.push(`/comic/i${issue.id}?region=${market}`)}
                      style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }}
                    >
                      {/* Cover — overflow visible, 3× zoom on hover, z-50 pops above siblings */}
                      <div
                        className="relative bg-gray-100 border border-gray-200 rounded-md transition-transform duration-300 ease-out hover:scale-[3] hover:z-50"
                        style={{ aspectRatio: '2 / 3', position: 'relative' }}
                      >
                        <span className="absolute inset-0 flex items-center justify-center text-gray-400 text-[10px] font-medium">
                          {label}
                        </span>
                        {cover && (
                          <img
                            src={cover}
                            alt={`${comic.name} ${label}`}
                            className="absolute inset-0 w-full h-full object-cover rounded-md"
                            loading="lazy"
                            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                          />
                        )}
                      </div>
                      <div style={{ marginTop: '4px', fontSize: '11px', fontWeight: 500, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
                      {sub && <div style={{ fontSize: '10px', color: '#9CA3AF' }}>{sub}</div>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── MOBILE: issues grid — stacked below pricing ──────────────────────
          Only shown on mobile (md:hidden). Desktop issues appear in the
          3-col body above. Same card style for visual consistency. */}
      {isVolume && (issuesLoading || issues.length > 0) && (
        <div className="md:hidden max-w-5xl mx-auto px-4 pb-8">
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '10px' }}>
            <h2 style={{ fontSize: '13px', fontWeight: 600, color: '#111827', margin: 0 }}>Issues in this series</h2>
            {!issuesLoading && issues.length > 0 && (
              <span style={{ fontSize: '11px', color: '#9CA3AF' }}>{issues.length}</span>
            )}
          </div>
          {issuesLoading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
              {[...Array(8)].map((_, i) => (
                <div key={i}>
                  <div style={{ aspectRatio: '2/3', borderRadius: '6px', background: '#F3F4F6' }} />
                  <div style={{ height: '10px', background: '#F3F4F6', borderRadius: '4px', marginTop: '6px', width: '60%' }} />
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
              {issues.map(issue => {
                const cover = issue.image.medium_url || issue.image.small_url
                const label = issue.issue_number ? `#${issue.issue_number}` : (issue.name || 'Issue')
                const sub   = issue.cover_year || ''
                return (
                  <button
                    key={issue.id}
                    onClick={() => router.push(`/comic/i${issue.id}?region=${market}`)}
                    style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }}>
                    <div style={{ aspectRatio: '2/3', borderRadius: '6px', background: '#F3F4F6', border: '1px solid #EBEBEB', position: 'relative' }}>
                      <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF', fontSize: '9px', fontWeight: 500 }}>
                        {label}
                      </span>
                      {cover && (
                        <img
                          src={cover}
                          alt={`${comic.name} ${label}`}
                          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: '6px' }}
                          loading="lazy"
                          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                        />
                      )}
                    </div>
                    <div style={{ marginTop: '4px', fontSize: '10px', fontWeight: 500, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
                    {sub && <div style={{ fontSize: '9px', color: '#9CA3AF' }}>{sub}</div>}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── MOBILE FILTER DRAWER — same pattern as search page ───────────────── */}
      {mobileFilterOpen && (
        <>
          <div
            onClick={() => setMobileFilterOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 40 }}
          />
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
                aria-label="Close filters"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', fontSize: '20px', lineHeight: 1 }}>
                <span aria-hidden="true">✕</span>
              </button>
            </div>

            {/* Clear all */}
            {(priceMax !== 'all' || condition !== 'all' || formatFilter !== 'all') && (
              <button
                onClick={() => { setPriceMax('all'); setCondition('all'); setFormatFilter('all'); setMobileFilterOpen(false) }}
                style={{ fontSize: '11px', color: '#C41F22', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', marginBottom: '16px' }}>
                Clear all filters
              </button>
            )}

            {/* Condition */}
            <div style={{ borderTop: '1px solid #EBEBEB' }}>
              <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#374151', padding: '12px 0 8px', margin: 0 }}>Condition</p>
              {([['all', 'All conditions'], ['new', 'New'], ['used', 'Used']] as [string, string][]).map(([val, label]) => {
                const active = condition === val
                return (
                  <button key={val} onClick={() => { setCondition(val as typeof condition); setMobileFilterOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0', textAlign: 'left', fontFamily: 'inherit' }}>
                    <span style={{ width: '16px', height: '16px', borderRadius: '50%', flexShrink: 0, border: `2px solid ${active ? '#E8272A' : '#D1D5DB'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
                      {active && <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#E8272A', display: 'block' }} />}
                    </span>
                    <span style={{ fontSize: '14px', color: active ? '#0A0A0A' : '#4B5563', fontWeight: active ? 600 : 400 }}>{label}</span>
                  </button>
                )
              })}
            </div>

            {/* Price Range */}
            <div style={{ borderTop: '1px solid #EBEBEB', marginTop: '8px' }}>
              <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#374151', padding: '12px 0 8px', margin: 0 }}>Price Range</p>
              {([
                ['all', 'All prices'],
                ['5',   `Under ${market === 'uk' ? '£' : '$'}5`],
                ['10',  `Under ${market === 'uk' ? '£' : '$'}10`],
                ['15',  `Under ${market === 'uk' ? '£' : '$'}15`],
                ['25',  `Under ${market === 'uk' ? '£' : '$'}25`],
                ['35',  `Under ${market === 'uk' ? '£' : '$'}35`],
                ['50',  `Under ${market === 'uk' ? '£' : '$'}50`],
              ] as [string, string][]).map(([val, label]) => {
                const active = priceMax === val
                return (
                  <button key={val} onClick={() => { setPriceMax(val as typeof priceMax); setMobileFilterOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0', textAlign: 'left', fontFamily: 'inherit' }}>
                    <span style={{ width: '16px', height: '16px', borderRadius: '50%', flexShrink: 0, border: `2px solid ${active ? '#E8272A' : '#D1D5DB'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
                      {active && <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#E8272A', display: 'block' }} />}
                    </span>
                    <span style={{ fontSize: '14px', color: active ? '#0A0A0A' : '#4B5563', fontWeight: active ? 600 : 400 }}>{label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </>
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