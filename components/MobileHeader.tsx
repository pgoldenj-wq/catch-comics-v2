'use client'
/**
 * MobileHeader — shared sticky header for all mobile pages (md:hidden).
 *
 * Two variants:
 *   'discovery' — homepage. Logo left, UK / US abbreviated region pills right.
 *   'search'    — search + comic detail. Logo left, search bar centre, region pills right.
 *
 * Region pills match the desktop pill system exactly:
 *   active   → filled #0A0A0A, white text
 *   inactive → 1px #E5E7EB border, white bg, #6B7280 text
 *
 * Desktop headers (hidden md:block wrappers) are untouched.
 */

import SearchBar from '@/components/SearchBar'

// ── Flag SVGs ─────────────────────────────────────────────────────────────────

function UKFlag() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 60 30"
      preserveAspectRatio="xMidYMid slice"
      style={{ width: '100%', height: '100%', display: 'block' }}
      aria-hidden="true">
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
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 60 30"
      preserveAspectRatio="xMinYMid slice"
      style={{ width: '100%', height: '100%', display: 'block' }}
      aria-hidden="true">
      <rect width="60" height="30" fill="#B22234"/>
      <path d="M0 3.46h60M0 6.92h60M0 10.38h60M0 13.85h60M0 17.31h60M0 20.77h60M0 24.23h60" stroke="#fff" strokeWidth="2.31"/>
      <rect width="24" height="16.15" fill="#3C3B6E"/>
      <g fill="#fff">
        {[...Array(5)].map((_, row) =>
          [...Array(row % 2 === 0 ? 6 : 5)].map((_, col) => {
            const cx = row % 2 === 0 ? 2 + col * 4 : 4 + col * 4
            const cy = 2 + row * 3
            return (
              <polygon
                key={`${row}-${col}`}
                points={STAR_5_POINTS}
                transform={`translate(${cx} ${cy})`}
              />
            )
          })
        )}
      </g>
    </svg>
  )
}

// ── Region pill ───────────────────────────────────────────────────────────────
// Mirrors the desktop pill logic exactly (filled black active / bordered inactive).

function RegionPill({
  active, value, label, onClick,
}: {
  active: boolean
  value:  'uk' | 'us'
  label:  string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-label={value === 'uk' ? 'UK prices' : 'US prices'}
      aria-pressed={active}
      style={{
        display: 'flex', alignItems: 'center', gap: '5px',
        padding: '0 10px', height: '36px', borderRadius: '999px',
        border: `${active ? '1.5' : '1'}px solid ${active ? '#0A0A0A' : '#E5E7EB'}`,
        background: active ? '#0A0A0A' : '#fff',
        cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
        transition: 'border-color 0.12s, background 0.12s',
      }}>
      <span style={{
        width: '20px', height: '20px', borderRadius: '50%',
        overflow: 'hidden', flexShrink: 0, display: 'block', background: '#f3f4f6',
      }}>
        {value === 'uk' ? <UKFlag /> : <USFlag />}
      </span>
      <span style={{ fontSize: '12px', fontWeight: 600, color: active ? '#fff' : '#6B7280' }}>
        {label}
      </span>
    </button>
  )
}

// ── MobileHeader ──────────────────────────────────────────────────────────────

export interface MobileHeaderProps {
  variant:        'discovery' | 'search'
  region:         'uk' | 'us'
  onRegionChange: (r: 'uk' | 'us') => void
  /** Search variant only — pre-fills the SearchBar input. */
  initialQuery?:  string
}

export default function MobileHeader({
  variant, region, onRegionChange, initialQuery,
}: MobileHeaderProps) {
  return (
    <header
      className="md:hidden"
      style={{
        background: '#fff',
        borderBottom: '1px solid #F0F0F0',
        position: 'sticky',
        top: 0,
        zIndex: 20,
      }}>
      <div style={{
        height: '64px', padding: '0 16px',
        display: 'flex', alignItems: 'center', gap: '10px',
      }}>

        {/* Logo — always left, links home */}
        <a href="/" style={{ flexShrink: 0, lineHeight: 0 }}>
          <img src="/logo.png" alt="Catch Comics" style={{ height: '40px', width: 'auto' }} />
        </a>

        {variant === 'discovery' ? (
          /* Discovery: region pills fill the right side */
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
            <RegionPill active={region === 'uk'} value="uk" label="UK" onClick={() => onRegionChange('uk')} />
            <RegionPill active={region === 'us'} value="us" label="US" onClick={() => onRegionChange('us')} />
          </div>
        ) : (
          /* Search: search bar fills remaining space after logo.
             No region pills in the header — they live in the content area
             ("Prices for: UK | US") so the header stays focused on search. */
          <div style={{ flex: 1, minWidth: 0 }}>
            <SearchBar region={region} variant="header" initialQuery={initialQuery} />
          </div>
        )}

      </div>
    </header>
  )
}
