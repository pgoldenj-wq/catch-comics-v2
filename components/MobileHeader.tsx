'use client'
/**
 * MobileHeader — shared sticky header for all mobile pages (md:hidden).
 *
 * Two variants:
 *   'discovery' — homepage. Logo left, Series nav + static UK indicator right.
 *   'search'    — search + comic detail. Logo left, search bar fills the rest.
 *
 * Region: this header used to carry UK / US pills. Desktop dropped its selector
 * because picking US switched the eBay path to EBAY_US and presented USD listings
 * as Catch Comics offers, which a UK price-comparison site must not do; mobile
 * kept the pills and was worse — every homepage deal has lowestPriceUSD = null,
 * so tapping "US" removed every price from the rail while the heading still read
 * "Live prices from retailers" (founder review 2026-08-24). It is now the same
 * static UK indicator the desktop Navbar shows: a fact, not a choice.
 *
 * Desktop headers (hidden md:block wrappers) are untouched.
 */

import Link      from 'next/link'
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

// ── Static UK indicator ───────────────────────────────────────────────────────
// Mirrors the desktop Navbar: Catch Comics compares UK prices, so this states a
// fact rather than offering a region choice. See the file header for why.

function UKIndicator() {
  return (
    <div
      className="flex items-center gap-1.5 rounded-full border shrink-0"
      style={{ borderColor: '#E5E7EB', background: '#fff', padding: '0 10px', height: '36px' }}
      title="Catch Comics compares UK prices"
    >
      <span
        className="rounded-full overflow-hidden shrink-0 block"
        style={{ width: '20px', height: '20px', background: '#f3f4f6' }}
      >
        <UKFlag />
      </span>
      <span style={{ fontSize: '12px', fontWeight: 600, color: '#6B7280' }}>UK</span>
    </div>
  )
}

// ── MobileHeader ──────────────────────────────────────────────────────────────

export interface MobileHeaderProps {
  variant:        'discovery' | 'search'
  region:         'uk' | 'us'
  /**
   * @deprecated No longer called — the header shows a static UK indicator rather
   * than a region selector (see the file header). Kept so existing call sites
   * keep type-checking; safe to drop once they stop passing it.
   */
  onRegionChange?: (r: 'uk' | 'us') => void
  /** Search variant only — pre-fills the SearchBar input. */
  initialQuery?:  string
}

export default function MobileHeader({
  variant, region, initialQuery,
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
        <Link href="/" style={{ flexShrink: 0, lineHeight: 0 }} aria-label="Catch Comics home">
          <img src="/logo.png" alt="Catch Comics" style={{ height: '40px', width: 'auto' }} />
        </Link>

        {variant === 'discovery' ? (
          /* Discovery: primary nav + static UK indicator on the right. Series is
             a bordered chip so it reads as a destination rather than loose text
             beside the wordmark (founder review 2026-08-24). */
          <>
            <nav aria-label="Primary" style={{ marginLeft: 'auto', display: 'flex', flexShrink: 0 }}>
              <Link
                href="/series"
                className="flex items-center rounded-full border shrink-0"
                style={{
                  borderColor:    '#E5E7EB',
                  background:     '#fff',
                  padding:        '0 14px',
                  height:         '36px',
                  fontSize:       '13px',
                  fontWeight:     600,
                  color:          '#374151',
                  textDecoration: 'none',
                  whiteSpace:     'nowrap',
                }}
              >
                Series
              </Link>
            </nav>
            <UKIndicator />
          </>
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
