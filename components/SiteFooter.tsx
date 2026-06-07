/**
 * SiteFooter — shared site-wide footer.
 *
 * Renders a dark footer on all pages with:
 *   - Short affiliate disclosure
 *   - Links to legal pages (About · Affiliate Disclosure · Privacy · Terms)
 *   - Copyright notice
 *
 * Intentionally uses inline styles (consistent with the legal-page pattern
 * already used across About / Privacy / Terms) so no Tailwind purge issues.
 */

import Link from 'next/link'

const NAV_LINKS: { label: string; href: string }[] = [
  { label: 'About',                href: '/about' },
  { label: 'Affiliate Disclosure', href: '/affiliate-disclosure' },
  { label: 'Privacy',              href: '/privacy' },
  { label: 'Terms',                href: '/terms' },
]

export default function SiteFooter() {
  const year = new Date().getFullYear()

  return (
    <footer
      style={{
        background:   '#0d1117',
        borderTop:    '1px solid rgba(255,255,255,0.06)',
        padding:      '32px 24px 28px',
        textAlign:    'center',
        marginTop:    'auto',
      }}
      aria-label="Site footer"
    >
      {/* Affiliate disclosure */}
      <p
        style={{
          fontSize:  '12px',
          color:     'rgba(255,255,255,0.38)',
          lineHeight: 1.7,
          maxWidth:  '620px',
          margin:    '0 auto 16px',
        }}
      >
        Catch Comics is a price-comparison service. When you click a retailer link we may earn a
        small affiliate commission at no extra cost to you. Prices are sourced from retailers and
        may change — always verify the final price on the retailer&apos;s site before purchasing.
        We are not a retailer and do not process payments or hold stock.
      </p>

      {/* Legal links */}
      <nav
        aria-label="Legal pages"
        style={{
          display:        'flex',
          justifyContent: 'center',
          flexWrap:       'wrap',
          gap:            '6px 18px',
          marginBottom:   '16px',
        }}
      >
        {NAV_LINKS.map(({ label, href }) => (
          <Link
            key={href}
            href={href}
            style={{
              fontSize:       '11px',
              color:          'rgba(255,255,255,0.35)',
              textDecoration: 'none',
            }}
            className="hover:text-[#E8272A] transition-colors"
          >
            {label}
          </Link>
        ))}
      </nav>

      {/* Copyright */}
      <p style={{ fontSize: '11px', color: 'rgba(255,255,255,0.2)' }}>
        © {year} Catch Comics. All prices shown are indicative only.
      </p>
    </footer>
  )
}
