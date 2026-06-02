import type { Metadata }    from 'next'
import { notFound }         from 'next/navigation'
import Link                 from 'next/link'
import Navbar               from '@/components/Navbar'
import { getSeriesEntry, getAllSeriesSlugs } from '@/lib/series/registry'
import { getSeriesData }    from '@/lib/series/getSeriesData'
import SeriesHero           from './_components/SeriesHero'
import VolumeGrid           from './_components/VolumeGrid'
import EditionComparison    from './_components/EditionComparison'

// ISR: same cadence as product pages
export const revalidate = 3600

// ── Static generation ─────────────────────────────────────────────────────────

export function generateStaticParams() {
  return getAllSeriesSlugs().map(slug => ({ slug }))
}

// ── SEO metadata ──────────────────────────────────────────────────────────────

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params
  const entry    = getSeriesEntry(slug)
  if (!entry) return { title: 'Not Found' }

  const data        = await getSeriesData(entry)
  const volCount    = data.volumes.length
  const firstVol    = data.volumes[0]
  const fromText    = firstVol?.lowestPrice
    ? ` from £${firstVol.lowestPrice.toFixed(2)}`
    : ''

  const description = data.description
    ? data.description.slice(0, 160)
    : `${entry.displayName} — ${volCount} volume${volCount !== 1 ? 's' : ''}.` +
      ` Start with Vol. 1${fromText}. Compare prices across UK retailers.`

  const BASE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://catchcomics.com').replace(/\/$/, '')
  const url      = `${BASE_URL}/series/${slug}`

  return {
    title:       `${entry.displayName} Reading Order & Complete Buying Guide`,
    description,
    alternates:  { canonical: url },
    openGraph: {
      title:       `${entry.displayName} Reading Order`,
      description,
      url,
      type:        'website',
      ...(data.heroCoverUrl ? { images: [{ url: data.heroCoverUrl, width: 400, height: 600, alt: entry.displayName }] } : {}),
    },
    twitter: {
      card:        data.heroCoverUrl ? 'summary_large_image' : 'summary',
      title:       `${entry.displayName} Reading Order`,
      description,
      ...(data.heroCoverUrl ? { images: [data.heroCoverUrl] } : {}),
    },
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function SeriesPage(
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const entry    = getSeriesEntry(slug)
  if (!entry) notFound()

  const data     = await getSeriesData(entry)
  const BASE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://catchcomics.com').replace(/\/$/, '')

  // ── JSON-LD ────────────────────────────────────────────────────────────────
  const bookSeriesLd = {
    '@context':       'https://schema.org',
    '@type':          'BookSeries',
    name:             entry.displayName,
    numberOfVolumes:  data.volumes.length,
    url:              `${BASE_URL}/series/${slug}`,
    ...(entry.publisher
      ? { publisher: { '@type': 'Organization', name: entry.publisher } }
      : {}),
  }

  const itemListLd = {
    '@context':   'https://schema.org',
    '@type':      'ItemList',
    name:         `${entry.displayName} Reading Order`,
    numberOfItems: data.volumes.length,
    itemListElement: data.volumes.map((v, i) => ({
      '@type':   'ListItem',
      position:  i + 1,
      item: {
        '@type': 'Book',
        name:    v.title,
        url:     `${BASE_URL}/product/${v.slug}`,
        ...(v.isbn13 ? { isbn: v.isbn13 } : {}),
      },
    })),
  }

  return (
    <>
      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(bookSeriesLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListLd) }}
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
          <span className="text-gray-400">Series</span>
          <span className="mx-2 text-gray-300">/</span>
          <span className="text-gray-700 truncate">{entry.displayName}</span>
        </nav>

        {/* Hero */}
        <SeriesHero entry={entry} seriesData={data} />

        {/* Content */}
        <section className="max-w-6xl mx-auto px-4 py-12">
          <VolumeGrid volumes={data.volumes} seriesName={entry.displayName} />
          <EditionComparison groups={data.editionGroups} />
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
