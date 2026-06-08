'use client'

/**
 * Navbar — shared desktop site header for all pages.
 *
 * Layout: logo (left) | search bar (centre, max 520px) | UK/US toggle (right)
 * Height: 64px (h-16) on mobile, 80px (h-20) on desktop.
 * Logo:   40px tall on mobile, 48px (h-12) on desktop.
 *
 * Region state:
 *   - Controlled: pass `region` + `onRegionChange` — used by pages whose
 *     content reacts to the region (homepage, search).
 *   - Uncontrolled: omit both props — Navbar manages its own state.
 *     Used by the product page where region only affects search navigation.
 */

import { useState }     from 'react'
import { usePathname }  from 'next/navigation'
import Link             from 'next/link'
import SearchBar        from '@/components/SearchBar'

// ── Flag SVGs ─────────────────────────────────────────────────────────────────

function UKFlag() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice"
      style={{ width: '100%', height: '100%', display: 'block' }} aria-hidden="true">
      <path d="M0 0v30h60V0z" fill="#012169"/>
      <path d="M0 0l60 30m0-30L0 30" stroke="#fff" strokeWidth="6"/>
      <path d="M0 0l60 30m0-30L0 30" stroke="#C8102E" strokeWidth="4"/>
      <path d="M30 0v30M0 15h60" stroke="#fff" strokeWidth="10"/>
      <path d="M30 0v30M0 15h60" stroke="#C8102E" strokeWidth="6"/>
    </svg>
  )
}

const STAR_5_POINTS = '0,-1.2 0.27,-0.37 1.14,-0.37 0.44,0.14 0.71,0.97 0,0.46 -0.71,0.97 -0.44,0.14 -1.14,-0.37 -0.27,-0.37'

function USFlag() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30" preserveAspectRatio="xMinYMid slice"
      style={{ width: '100%', height: '100%', display: 'block' }} aria-hidden="true">
      <rect width="60" height="30" fill="#B22234"/>
      <path d="M0 3.46h60M0 6.92h60M0 10.38h60M0 13.85h60M0 17.31h60M0 20.77h60M0 24.23h60" stroke="#fff" strokeWidth="2.31"/>
      <rect width="24" height="16.15" fill="#3C3B6E"/>
      <g fill="#fff">
        {[...Array(5)].map((_, row) =>
          [...Array(row % 2 === 0 ? 6 : 5)].map((_, col) => {
            const cx = row % 2 === 0 ? 2 + col * 4 : 4 + col * 4
            const cy = 2 + row * 3
            return <polygon key={`${row}-${col}`} points={STAR_5_POINTS} transform={`translate(${cx} ${cy})`} />
          })
        )}
      </g>
    </svg>
  )
}

// ── Navbar ────────────────────────────────────────────────────────────────────

export interface NavbarProps {
  /** Pre-populate the search bar (e.g. on the search results page). */
  initialQuery?:   string
  /** Controlled region — pass together with onRegionChange. */
  region?:         'uk' | 'us'
  /** Called when the user clicks a region pill (controlled mode). */
  onRegionChange?: (r: 'uk' | 'us') => void
}

export default function Navbar({ initialQuery, region: controlledRegion, onRegionChange }: NavbarProps) {
  // Uncontrolled fallback — only used when `region` prop is not supplied.
  const [internalRegion, setInternalRegion] = useState<'uk' | 'us'>('uk')
  const pathname = usePathname()

  const region    = controlledRegion ?? internalRegion
  const setRegion = (r: 'uk' | 'us') => {
    setInternalRegion(r)
    onRegionChange?.(r)
  }

  return (
    <header style={{ background: '#fff', borderBottom: '1px solid #F0F0F0', position: 'sticky', top: 0, zIndex: 20 }}>
      <div className="max-w-6xl mx-auto px-8 h-20 flex items-center gap-4">

        {/* Logo */}
        <Link href="/" className="shrink-0" aria-label="Catch Comics home">
          <img src="/logo.png" alt="Catch Comics" className="h-12 w-auto" />
        </Link>

        {/* Series nav link — hidden below sm (640px) to prevent cramping on narrow viewports */}
        <Link
          href="/series"
          className="shrink-0 hidden sm:block"
          style={{
            fontSize:       '14px',
            fontWeight:     600,
            textDecoration: 'none',
            whiteSpace:     'nowrap',
            color:          pathname.startsWith('/series') ? '#E8272A' : '#374151',
            transition:     'color 0.15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#E8272A' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = pathname.startsWith('/series') ? '#E8272A' : '#374151' }}
        >
          Series
        </Link>

        {/* Search bar */}
        <div className="flex-1" style={{ maxWidth: '520px' }}>
          <SearchBar region={region} variant="header" initialQuery={initialQuery} />
        </div>

        {/* UK / US region pills */}
        <div className="flex items-center gap-3 ml-auto shrink-0">
          {(['uk', 'us'] as const).map(r => (
            <button
              key={r}
              onClick={() => setRegion(r)}
              aria-label={r === 'uk' ? 'UK prices' : 'US prices'}
              aria-pressed={region === r}
              className="flex items-center gap-2.5 pl-2 pr-4 py-1.5 rounded-full border-2 transition-all"
              style={{
                borderColor: region === r ? '#0A0A0A' : '#E5E7EB',
                background:  region === r ? '#0A0A0A' : '#fff',
              }}
            >
              <span
                className="flex items-center justify-center rounded-full overflow-hidden shrink-0"
                style={{ width: '32px', height: '32px', background: '#f3f4f6' }}
              >
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
  )
}
