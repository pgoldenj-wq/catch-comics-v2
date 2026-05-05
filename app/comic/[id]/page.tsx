'use client'

import { useEffect, useState, Suspense } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import PricingPanel from '@/components/PricingPanel'
import SearchBar from '@/components/SearchBar'

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
  const toggleSection = (id: string) => setOpenSections(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s
  })

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
      <nav className="sticky top-0 z-20 bg-white border-b border-gray-100 px-8 h-20 flex items-center gap-4">
        <a href="/" className="shrink-0">
          <img src="/logo.png" alt="Catch Comics" className="h-12 w-auto" />
        </a>
        <div className="flex-1" style={{ maxWidth: '480px' }}>
          <SearchBar region={market} variant="header" initialQuery={comic?.name ?? ''} />
        </div>
      </nav>

      {/* DARK HEADER — overflow visible so hero cover can scale beyond bounds on hover */}
      <div className="relative bg-[#111827]">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
          }}
        />
        {/* BACK NAV — inside the dark hero for visual anchoring and contrast */}
        <div className="relative px-8 pt-5 max-w-4xl mx-auto">
          <button
            onClick={() => router.back()}
            aria-label="Back to previous page"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              fontSize: '12px', color: 'rgba(255,255,255,0.45)',
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '6px 0', fontFamily: 'inherit', minHeight: '44px',
              transition: 'color 0.12s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.9)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.45)')}
          >
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Back to results
          </button>
        </div>

        <div className="relative px-8 pb-8 flex gap-6 max-w-4xl mx-auto">
          {/* Cover — hover zooms 2× for a closer look without obscuring the title.
              overflow-hidden removed from parent so the scaled cover can escape the box. */}
          <div className="relative w-28 h-40 rounded-lg border border-white/10 shadow-xl shrink-0 bg-white/5 flex items-center justify-center transition-transform duration-300 ease-out hover:scale-[2] hover:z-50">
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

          {/* Title + region toggle */}
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

          {/* ── METADATA PANEL ─────────────────────────────────────────────────
              Only rendered when there are people/character fields to show.
              Creator rows (writers, artists, etc.) render names as search links. */}
          {(() => {
            const people = comic.people || []
            const roleMatch = (role: string | null | undefined, kw: string) => (role ?? '').toLowerCase().includes(kw)
            const writers      = [...new Set(people.filter(p => roleMatch(p.role, 'writer')).map(p => p.name))]
            // Artists: penciler, inker, and general "artist" roles (excluding cover artists)
            const pencilers    = [...new Set(people.filter(p =>
              roleMatch(p.role, 'pencil') ||
              roleMatch(p.role, 'inker') ||
              (roleMatch(p.role, 'artist') && !roleMatch(p.role, 'cover'))
            ).map(p => p.name))]
            const colourists   = [...new Set(people.filter(p => roleMatch(p.role, 'colour') || roleMatch(p.role, 'color')).map(p => p.name))]
            const coverArtists = [...new Set(people.filter(p => roleMatch(p.role, 'cover')).map(p => p.name))]
            const chars        = (comic.characters || [])

            // links:true rows render each comma-separated name as a clickable search link
            const rows: { label: string; value: string; links?: boolean }[] = []
            if (writers.length)      rows.push({ label: writers.length > 1 ? 'Writers' : 'Writer',      value: writers.join(', '),      links: true })
            if (pencilers.length)    rows.push({ label: pencilers.length > 1 ? 'Artists' : 'Artist',    value: pencilers.join(', '),    links: true })
            if (colourists.length)   rows.push({ label: 'Colours',    value: colourists.join(', '),   links: true })
            if (coverArtists.length) rows.push({ label: 'Cover',      value: coverArtists.join(', '), links: true })
            if (comic.publisher?.name) rows.push({ label: 'Publisher', value: comic.publisher.name })
            if (comic.start_year)    rows.push({ label: 'Year',       value: comic.start_year })
            if (!isNaN(comic.count_of_issues) && comic.count_of_issues > 0)
                                     rows.push({ label: 'Issues',     value: String(comic.count_of_issues) })

            if (rows.length === 0 && chars.length === 0) return null

            return (
              <div style={{
                width: '180px', flexShrink: 0,
                borderLeft: '1px solid rgba(255,255,255,0.08)',
                paddingLeft: '20px',
                alignSelf: 'center',
              }}>
                <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {rows.map(({ label, value, links }) => (
                    <div key={label}>
                      <dt style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: '1px' }}>
                        {label}
                      </dt>
                      <dd style={{ margin: 0, fontSize: '12px', color: 'rgba(255,255,255,0.75)', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                        {links
                          ? value.split(', ').map((name, i, arr) => (
                              <span key={name}>
                                <a
                                  href={`/search?q=${encodeURIComponent(name)}&region=${market}`}
                                  style={{ color: 'rgba(255,255,255,0.75)', textDecoration: 'underline', textDecorationColor: 'rgba(255,255,255,0.25)', cursor: 'pointer' }}
                                  onMouseEnter={e => (e.currentTarget.style.color = '#fff')}
                                  onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.75)')}
                                >
                                  {name}
                                </a>
                                {i < arr.length - 1 ? ', ' : ''}
                              </span>
                            ))
                          : value}
                      </dd>
                    </div>
                  ))}

                  {/* CHARACTERS — interactive pill tags */}
                  {chars.length > 0 && (() => {
                    const VISIBLE = 4
                    const visible = chars.slice(0, VISIBLE)
                    const overflow = chars.length - VISIBLE
                    return (
                      <div key="characters">
                        <dt style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)', marginBottom: '4px' }}>
                          Characters
                        </dt>
                        <dd style={{ margin: 0, display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {visible.map(c => (
                            <a
                              key={c.id}
                              href={`/search?q=${encodeURIComponent(c.name)}&region=${market}`}
                              aria-label={`Search comics featuring ${c.name}`}
                              style={{
                                display: 'inline-block',
                                fontSize: '10px', fontWeight: 500,
                                padding: '2px 7px', borderRadius: '999px',
                                background: 'rgba(255,255,255,0.1)',
                                color: 'rgba(255,255,255,0.7)',
                                textDecoration: 'none',
                                border: '1px solid rgba(255,255,255,0.12)',
                                transition: 'background 0.12s, color 0.12s',
                                cursor: 'pointer',
                              }}
                              onMouseEnter={e => {
                                e.currentTarget.style.background = 'rgba(255,255,255,0.2)'
                                e.currentTarget.style.color = '#fff'
                              }}
                              onMouseLeave={e => {
                                e.currentTarget.style.background = 'rgba(255,255,255,0.1)'
                                e.currentTarget.style.color = 'rgba(255,255,255,0.7)'
                              }}
                            >
                              {c.name}
                            </a>
                          ))}
                          {overflow > 0 && (
                            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', alignSelf: 'center', paddingLeft: '2px' }}>
                              +{overflow} more
                            </span>
                          )}
                        </dd>
                      </div>
                    )
                  })()}
                </dl>
              </div>
            )
          })()}
        </div>
      </div>

      {/* ── BODY: three columns — filter sidebar | pricing | issues ─────────── */}
      <div className="max-w-5xl mx-auto px-8 py-6" style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>

        {/* ── FILTER SIDEBAR ──────────────────────────────────────────────────
            Matches the results-page sidebar style: sticky, collapsible sections,
            radio-style options. */}
        <aside style={{
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
          <div style={{ borderTop: '1px solid #F0F0F0' }}>
            <button
              onClick={() => toggleSection('condition')}
              aria-expanded={openSections.has('condition')}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                padding: '10px 0', fontSize: '10px', fontWeight: 700,
                letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6B7280',
                fontFamily: 'inherit',
              }}>
              Condition
              <span aria-hidden="true" style={{ fontSize: '9px', display: 'inline-block', transition: 'transform 0.15s', transform: openSections.has('condition') ? 'rotate(180deg)' : 'none' }}>▼</span>
            </button>
            {openSections.has('condition') && (
              <div style={{ paddingBottom: '14px' }}>
                {([
                  ['all',  'All'],
                  ['new',  'New'],
                  ['used', 'Used'],
                ] as [string, string][]).map(([val, label]) => {
                  const active = condition === val
                  return (
                    <button key={val} onClick={() => setCondition(val as typeof condition)}
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', textAlign: 'left', fontFamily: 'inherit' }}>
                      <span style={{ width: '14px', height: '14px', borderRadius: '50%', flexShrink: 0, border: `2px solid ${active ? '#E8272A' : '#D1D5DB'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
                        {active && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#E8272A', display: 'block' }} />}
                      </span>
                      <span style={{ fontSize: '13px', color: active ? '#0A0A0A' : '#6B7280', fontWeight: active ? 500 : 400 }}>{label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* PRICE RANGE — second */}
          <div style={{ borderTop: '1px solid #F0F0F0' }}>
            <button
              onClick={() => toggleSection('price')}
              aria-expanded={openSections.has('price')}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                padding: '10px 0', fontSize: '10px', fontWeight: 700,
                letterSpacing: '0.1em', textTransform: 'uppercase', color: '#6B7280',
                fontFamily: 'inherit',
              }}>
              Price Range
              <span aria-hidden="true" style={{ fontSize: '9px', display: 'inline-block', transition: 'transform 0.15s', transform: openSections.has('price') ? 'rotate(180deg)' : 'none' }}>▼</span>
            </button>
            {openSections.has('price') && (
              <div style={{ paddingBottom: '14px' }}>
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
                      style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', textAlign: 'left', fontFamily: 'inherit' }}>
                      <span style={{ width: '14px', height: '14px', borderRadius: '50%', flexShrink: 0, border: `2px solid ${active ? '#E8272A' : '#D1D5DB'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
                        {active && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#E8272A', display: 'block' }} />}
                      </span>
                      <span style={{ fontSize: '13px', color: active ? '#0A0A0A' : '#6B7280', fontWeight: active ? 500 : 400 }}>{label}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </aside>

        {/* ── PRICING (centre) ────────────────────────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <PricingPanel
            query={comic.name}
            region={market}
            formatFilter={formatFilter}
            onFormatChange={setFormatFilter}
            priceMax={priceMax}
            condition={condition}
          />
          <p className="text-xs text-gray-400 mt-8 leading-relaxed">
            Catch Comics links to third-party retailers. Prices and availability may vary.
          </p>
        </div>

        {/* ── ISSUES GRID (right, volumes only) ───────────────────────────────
            Cover frame: overflow visible so 3× hover can escape the cell.
            z-50 on hover stacks above neighbours inside this positioned container. */}
        {isVolume && (issuesLoading || issues.length > 0) && (
          <div style={{ width: '216px', flexShrink: 0, position: 'relative' }}>
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