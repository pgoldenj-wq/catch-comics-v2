import type { Metadata }    from 'next'
import Link                 from 'next/link'
import Navbar               from '@/components/Navbar'
import { SERIES_REGISTRY }  from '@/lib/series/registry'
import { getSeriesData }    from '@/lib/series/getSeriesData'
import SeriesIndexCard      from './_components/SeriesIndexCard'
import { jsonLdScriptString } from '@/lib/security/jsonLd'

export const revalidate = 3600

// ── SEO metadata ──────────────────────────────────────────────────────────────

export async function generateMetadata(): Promise<Metadata> {
  const count   = Object.keys(SERIES_REGISTRY).length
  const BASE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://catchcomics.com').replace(/\/$/, '')
  const url      = `${BASE_URL}/series`

  return {
    title:       `Reading Orders — ${count} Series`,
    description: `Complete reading orders and UK price comparison for ${count} comic and manga series. Find the right volume, compare prices across UK retailers.`,
    alternates:  { canonical: url },
    openGraph: {
      title:       'Comic Series Reading Orders — Catch Comics',
      description: `Complete reading orders for ${count} series — compare prices across UK retailers on every volume.`,
      url,
      type:        'website',
    },
    twitter: {
      card:        'summary',
      title:       'Comic Series Reading Orders — Catch Comics',
      description: `Complete reading orders for ${count} series, with UK price comparison on every volume.`,
    },
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function SeriesIndexPage() {
  const entries = Object.entries(SERIES_REGISTRY)

  // Fetch cover + volume count for each series in parallel.
  // ISR at 1h — 5 DB calls at build/revalidate time is negligible.
  const series = await Promise.all(
    entries.map(async ([slug, entry]) => {
      const data = await getSeriesData(entry)
      return {
        slug,
        displayName:  entry.displayName,
        publisher:    entry.publisher,
        heroCoverUrl: data.heroCoverUrl,
        volumeCount:  data.volumes.length,
      }
    })
  )

  const count    = series.length
  const BASE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://catchcomics.com').replace(/\/$/, '')

  // ── JSON-LD ────────────────────────────────────────────────────────────────
  const itemListLd = {
    '@context':    'https://schema.org',
    '@type':       'ItemList',
    name:          'Comic Series Reading Orders',
    url:           `${BASE_URL}/series`,
    numberOfItems: count,
    itemListElement: series.map((s, i) => ({
      '@type':    'ListItem',
      position:   i + 1,
      item: {
        '@type': 'BookSeries',
        name:    s.displayName,
        url:     `${BASE_URL}/series/${s.slug}`,
      },
    })),
  }

  return (
    <>
      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScriptString(itemListLd) }}
      />

      <main className="min-h-screen bg-white text-[#0A0A0A]">

        {/* Site header */}
        <Navbar />

        {/* Breadcrumb */}
        <nav
          className="max-w-6xl mx-auto px-4 pt-4 pb-2 text-sm text-gray-500"
          aria-label="Breadcrumb"
        >
          <Link href="/" className="hover:text-[#E8272A] transition-colors">Home</Link>
          <span className="mx-2 text-gray-300">/</span>
          <span className="text-gray-700">Series</span>
        </nav>

        {/* ── Hero ──────────────────────────────────────────────────────────── */}
        <section
          className="relative text-white overflow-hidden"
          style={{ background: '#111827' }}
        >
          {/* Dot grid */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)',
              backgroundSize:  '22px 22px',
            }}
          />
          {/* Red glow */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute"
            style={{
              top: '-80px', right: '-80px',
              width: '420px', height: '420px',
              background: 'radial-gradient(circle, rgba(232,39,42,0.14) 0%, transparent 65%)',
            }}
          />

          <div className="relative max-w-6xl mx-auto px-4 py-10 sm:py-14">
            <p style={{
              fontSize: '11px', fontWeight: 600, textTransform: 'uppercase',
              letterSpacing: '0.12em', color: '#E8272A', marginBottom: '12px',
            }}>
              Discovery
            </p>

            <h1
              className="font-bold leading-tight text-white"
              style={{ fontSize: 'clamp(1.75rem, 4vw, 2.75rem)', letterSpacing: '-0.025em', marginBottom: '12px' }}
            >
              Series Reading Orders
            </h1>

            <p style={{
              fontSize: '15px', lineHeight: 1.7,
              color: 'rgba(255,255,255,0.65)',
              maxWidth: '540px', marginBottom: 0,
            }}>
              {count} series with complete reading orders and UK price comparison on every volume.
              Find where to start, what comes next, and the best price across UK retailers.
            </p>
          </div>
        </section>

        {/* ── Series grid ───────────────────────────────────────────────────── */}
        <section className="max-w-6xl mx-auto px-4 py-12">
          <div
            className="grid gap-4 sm:gap-6"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}
          >
            {series.map(s => (
              <SeriesIndexCard
                key={s.slug}
                slug={s.slug}
                displayName={s.displayName}
                publisher={s.publisher}
                heroCoverUrl={s.heroCoverUrl}
                volumeCount={s.volumeCount}
              />
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer
          style={{
            borderTop: '1px solid #E5E7EB',
            marginTop: '48px',
            padding:   '20px 24px',
            textAlign: 'center',
          }}
        >
          <p style={{ fontSize: '11px', color: '#9CA3AF', lineHeight: 1.6, maxWidth: '640px', margin: '0 auto' }}>
            Catch Comics is a price-comparison service. When you click a retailer link we may earn a small
            affiliate commission at no extra cost to you. Prices are sourced directly from retailers and may
            change at any time — always verify the final price on the retailer&apos;s site before purchasing.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginTop: '10px' }}>
            {[['About', '/about'], ['Privacy', '/privacy'], ['Terms', '/terms']].map(([label, href]) => (
              <a
                key={href}
                href={href}
                className="text-[11px] text-[#9CA3AF] no-underline hover:text-[#E8272A] transition-colors"
              >
                {label}
              </a>
            ))}
          </div>
        </footer>

      </main>
    </>
  )
}
