/**
 * /product/[slug] — Product detail page.
 *
 * Server-rendered. Sections:
 *   1. Hero          — cover image, title, series/publisher/format/ISBN
 *   2. Best offer    — cheapest in-stock listing, "View deal" CTA
 *   3. All offers    — OffersTable client component with NEW/USED/ALL tabs
 *   4. Price history — PriceSparkline client component (7+ point threshold)
 *   5. Related       — same series OR same publisher+format (up to 4)
 *   6. SEO           — generateMetadata, JSON-LD, OpenGraph, canonical URL
 */

import type { Metadata }        from 'next'
import { notFound }             from 'next/navigation'
import Image                    from 'next/image'
import Link                     from 'next/link'
import { Suspense }             from 'react'
import { prisma }               from '@/lib/prisma'
import OffersTable, { type OfferRow }    from '@/components/OffersTable'
import PriceSparkline, { type SparkPoint } from '@/components/PriceSparkline'
import { lookupByIsbn as lookupAmazon }  from '@/lib/adapters/amazon-rainforest'
import Navbar                            from '@/components/Navbar'
import CVCharacterTags                   from '@/components/CVCharacterTags'
import CVIssuesGrid                      from '@/components/CVIssuesGrid'
import CVCoverImage                      from '@/components/CVCoverImage'
import { isBadCoverUrl }                 from '@/lib/images/url-filters'

// ISR: cache each product page for 1 hour, then regenerate in the background.
// Switched from force-dynamic (which hit the DB on every request) now that the
// on-demand Rainforest lookup is effectively disabled (key not set). Price data
// updates via AWIN feed syncs and the Wordery enrichment script, which run
// externally — 1h staleness is acceptable and dramatically reduces DB load.
export const revalidate = 3600

// ── Helpers ───────────────────────────────────────────────────────────────────

const FORMAT_LABELS: Record<string, string> = {
  SINGLE_ISSUE:  'Single Issue',
  TPB:           'Trade Paperback',
  HARDCOVER:     'Hardcover',
  OMNIBUS:       'Omnibus',
  DELUXE:        'Deluxe Edition',
  COMPENDIUM:    'Compendium',
  MANGA_VOLUME:  'Manga Volume',
  ABSOLUTE:      'Absolute Edition',
  OTHER:         'Comic',
}

function fmtPrice(amount: number, currency: string) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency', currency, maximumFractionDigits: 2,
  }).format(amount)
}

function fmtDate(d: Date | string | null) {
  if (!d) return null
  return new Date(d).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

// ── Data layer ────────────────────────────────────────────────────────────────

async function getProduct(slug: string) {
  return prisma.canonicalProduct.findUnique({
    where: { canonicalSlug: slug },
    include: {
      listings: {
        where: {
          retailer   : { isActive: true },
          deletedAt  : null,
          // Exclude dynamic-link stubs that have no real price yet.
          // Bookshop.org listings created before an API key is configured
          // are stored with priceAmount=0.00 / stockStatus=UNKNOWN so that
          // the /go/[id] affiliate redirect still works, but they should not
          // appear in the price-comparison table.
          priceAmount: { gt: 0 },
        },
        include: {
          retailer: {
            select: {
              name:             true,
              trustScore:       true,
              affiliateNetwork: true,
              affiliateId:      true,
            },
          },
          priceHistory: {
            orderBy: { recordedAt: 'asc' },
            take:    90,
            select:  { priceAmount: true, priceCurrency: true, recordedAt: true },
          },
        },
        orderBy: { priceAmount: 'asc' },
      },
    },
  })
}

/** Returns price=0 active listings (DYNAMIC_LINK retailers like Forbidden Planet). */
async function getDynamicLinks(canonicalProductId: string) {
  return prisma.retailerListing.findMany({
    where: {
      canonicalProductId,
      deletedAt  : null,
      priceAmount: { lte: 0 },
      retailer   : { isActive: true },
    },
    select: {
      id         : true,
      retailerUrl: true,
      retailer   : { select: { name: true, domain: true } },
    },
    orderBy: { retailer: { name: 'asc' } },
  })
}

async function getRelated(
  productId: string,
  seriesName: string | null,
  publisher:  string | null,
  format:     string,
) {
  const orClauses: object[] = []
  if (seriesName) orClauses.push({ seriesName })
  if (publisher)  orClauses.push({ publisher, format })

  if (orClauses.length === 0) return []

  return prisma.canonicalProduct.findMany({
    where: {
      id:  { not: productId },
      OR:  orClauses,
    },
    select: {
      id:            true,
      title:         true,
      coverImageUrl: true,
      canonicalSlug: true,
      format:        true,
      publisher:     true,
    },
    orderBy: { releaseDate: 'desc' },
    take:    4,
  })
}

/** Single issues in the same series — for collected edition pages only. */
async function getSingleIssues(productId: string, seriesName: string | null) {
  if (!seriesName) return []
  return prisma.canonicalProduct.findMany({
    where: {
      id:         { not: productId },
      seriesName,
      format:     'SINGLE_ISSUE',
      deletedAt:  null,
    },
    select: {
      id:            true,
      title:         true,
      coverImageUrl: true,
      canonicalSlug: true,
      issueNumber:   true,
      releaseDate:   true,
    },
    orderBy: [
      // Chronological reading order: by issue number first, then release date
      { releaseDate: 'asc' },
    ],
    take: 20,
  })
}

// ── generateMetadata ──────────────────────────────────────────────────────────

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params
  const product  = await getProduct(slug)
  if (!product) return { title: 'Not Found' }

  const title       = product.title
  const description = product.description
    ?? `Compare prices for ${title}${product.publisher ? ` from ${product.publisher}` : ''}.`
  const BASE_URL    = (process.env.NEXT_PUBLIC_SITE_URL || 'https://catchcomics.com').replace(/\/$/, '')
  const url         = `${BASE_URL}/product/${slug}`
  const image       = product.coverImageUrl

  return {
    title:       `${title} — Catch Comics`,
    description,
    alternates:  { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: 'website',
      ...(image ? { images: [{ url: image, width: 400, height: 600, alt: title }] } : {}),
    },
    twitter: {
      card:        image ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  }
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ProductPage(
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const product  = await getProduct(slug)
  if (!product) notFound()

  // Collected editions show single issues from the same series in a separate
  // browseable section. Single issues themselves skip this query (returns []).
  const isCollectedEdition = !['SINGLE_ISSUE'].includes(product.format)

  // CV metadata extraction. Three things we pull out for the editorial hero:
  //   - cv_volume_id: the parent volume for SINGLE_ISSUE products
  //   - synopsis:     CV's full description (often richer than retailer-fed)
  //   - creators:     [{ id, name, role }] — writer / artist / cover etc.
  //
  // For collected editions, comicvine_id IS the volume id — pass it directly to
  // CVIssuesGrid. For SINGLE_ISSUE products (created by scripts/ingest-cv-series.ts),
  // comicvine_id holds the ISSUE id and the volume id lives in cv_metadata.cv_volume_id.
  interface CvMetaShape {
    cv_volume_id?: number | string
    synopsis?:     string | null
    creators?:     Array<{ id?: number; name: string; role?: string }>
  }
  const cvMeta = (product as { cvMetadata?: CvMetaShape | null }).cvMetadata ?? null

  const cvVolumeIdRaw = product.format === 'SINGLE_ISSUE'
    ? (cvMeta?.cv_volume_id ?? null)
    : product.comicvineId
  const cvVolumeId    = cvVolumeIdRaw !== null && cvVolumeIdRaw !== undefined ? String(cvVolumeIdRaw) : null

  // Description: prefer CV's synopsis when it's substantively longer than the
  // retailer-fed description. CV synopses often include HTML — strip tags for
  // safe server rendering.
  const stripHtml = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const cvSynopsis = cvMeta?.synopsis ? stripHtml(cvMeta.synopsis) : ''
  const dbDesc     = product.description?.trim() ?? ''
  const displayDescription = cvSynopsis.length > dbDesc.length + 40 ? cvSynopsis : dbDesc

  // Creators grouped by role for the hero block. CV roles use slash separators
  // like "writer, penciler" for multi-role credits — split them out.
  const creatorsByRole = new Map<string, string[]>()
  for (const c of (cvMeta?.creators ?? [])) {
    if (!c?.name) continue
    const roles = (c.role ?? 'creator').split(/\s*[,/]\s*/).filter(Boolean)
    for (const r of roles) {
      const key = r.toLowerCase().trim()
      const list = creatorsByRole.get(key) ?? []
      if (!list.includes(c.name)) list.push(c.name)
      creatorsByRole.set(key, list)
    }
  }
  // Order roles editorially — writer first, then visual roles
  const ROLE_ORDER = ['writer','penciler','penciller','artist','inker','colorist','cover','letterer','editor']
  const orderedCreators = ROLE_ORDER
    .filter(r => creatorsByRole.has(r))
    .map(r => ({ role: r, names: creatorsByRole.get(r)! }))

  const [related, dynamicLinks, singleIssues] = await Promise.all([
    getRelated(product.id, product.seriesName, product.publisher, product.format),
    getDynamicLinks(product.id),
    isCollectedEdition ? getSingleIssues(product.id, product.seriesName) : Promise.resolve([]),
  ])

  // ── Amazon on-demand lookup (non-blocking, 800 ms budget) ────────────────
  // Only attempted for canonical products with an ISBN-13.
  // Promise.race: if Rainforest resolves within 800ms include the offer in the
  // initial SSR render; otherwise the page renders without it (graceful skip).
  // The TTL check inside lookupByIsbn means a DB-cached result (~1ms) almost
  // always wins the race; a live API call may not.
  let amazonOffer: Awaited<ReturnType<typeof lookupAmazon>> = null
  if (product.isbn13) {
    try {
      amazonOffer = await Promise.race([
        lookupAmazon(product.isbn13, product.id, 'amazon.co.uk'),
        new Promise<null>(resolve => setTimeout(() => resolve(null), 800)),
      ])
    } catch (err) {
      // RainforestQuotaError (402) or other transient failures — skip gracefully.
      // The page renders without an Amazon offer rather than crashing.
      console.warn('[product] Amazon lookup failed for ISBN', product.isbn13, err instanceof Error ? err.message : err)
    }
  }

  // ── Offer processing ─────────────────────────────────────────────────────
  const IN_STOCK_STATUSES = new Set(['IN_STOCK', 'LOW_STOCK', 'PREORDER'])
  const allListings       = product.listings

  // Best offer = cheapest in-stock listing across all conditions
  const bestListing = allListings.find(l => IN_STOCK_STATUSES.has(l.stockStatus))

  // Merge Amazon offer into listings if it's not already present (fromCache=true
  // means it was already in allListings via the DB fetch above).
  if (amazonOffer && !amazonOffer.fromCache) {
    const alreadyPresent = allListings.some(l => l.id === amazonOffer!.listingId)
    if (!alreadyPresent) {
      // Re-query to get the freshly upserted listing in the same shape.
      // Guard deletedAt: a listing soft-deleted between upsert and here should
      // not be surfaced to the user.
      const freshAmazon = await prisma.retailerListing.findFirst({
        where  : { id: amazonOffer.listingId, deletedAt: null },
        include: {
          retailer    : { select: { name: true, trustScore: true, affiliateNetwork: true, affiliateId: true } },
          priceHistory: { orderBy: { recordedAt: 'asc' }, take: 90, select: { priceAmount: true, priceCurrency: true, recordedAt: true } },
        },
      })
      if (freshAmazon) {
        // Insert sorted by price (allListings is already price-sorted)
        const insertAt = allListings.findIndex(l => Number(l.priceAmount) > Number(freshAmazon.priceAmount))
        if (insertAt === -1) allListings.push(freshAmazon as typeof allListings[0])
        else                 allListings.splice(insertAt, 0, freshAmazon as typeof allListings[0])
      }
    }
  }

  // All offers for the table (in-stock first, then OOS)
  const offers: OfferRow[] = allListings.map(l => ({
    listingId:       l.id,
    retailerName:    l.retailer.name,
    retailerUrl:     l.retailerUrl,
    condition:       l.condition,
    conditionDetail: l.conditionDetail,
    priceAmount:     Number(l.priceAmount),
    currency:        l.priceCurrency,
    shippingAmount:  l.shippingAmount !== null ? Number(l.shippingAmount) : null,
    stockStatus:     l.stockStatus,
    lastSeenAt:      l.lastSeenAt.toISOString(),
    trustScore:      l.retailer.trustScore,
  }))

  // ── Price history sparkline data ─────────────────────────────────────────
  // Merge all price history across listings; bucket by date; take daily minimum.
  const dailyMin = new Map<string, number>()
  for (const l of allListings) {
    for (const ph of l.priceHistory) {
      const day   = ph.recordedAt.toISOString().slice(0, 10)
      const price = Number(ph.priceAmount)
      const cur   = dailyMin.get(day)
      if (cur === undefined || price < cur) dailyMin.set(day, price)
    }
  }
  const sparkPoints: SparkPoint[] = [...dailyMin.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, price]) => ({ date, price }))

  const primaryCurrency = bestListing?.priceCurrency ?? (allListings[0]?.priceCurrency ?? 'GBP')

  // ── JSON-LD ──────────────────────────────────────────────────────────────
  // Using @type: Book (not Product) because:
  //   1. Comics/graphic novels/manga are ISBNed books — semantically correct
  //   2. Google's Book rich results support price comparison per retailer
  //   3. Individual Offer items per retailer allow each to surface in Shopping
  // Schema: https://schema.org/Book
  const inStockOffers = allListings.filter(l => IN_STOCK_STATUSES.has(l.stockStatus))
  const BASE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://catchcomics.com').replace(/\/$/, '')

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type':    'Book',
    name:       product.title,
    ...(product.description  ? { description: product.description }  : {}),
    ...(product.coverImageUrl ? { image: product.coverImageUrl }     : {}),
    ...(product.isbn13        ? { isbn: product.isbn13 }             : {}),
    ...(product.publisher
      ? { publisher: { '@type': 'Organization', name: product.publisher } }
      : {}),
    // Individual Offer per retailer — lets Google surface each source's price.
    // Falls back to AggregateOffer summary when no in-stock offers exist.
    ...(inStockOffers.length > 0
      ? {
          offers: [
            // AggregateOffer for the price range summary (rich snippet)
            {
              '@type':       'AggregateOffer',
              offerCount:    inStockOffers.length,
              lowPrice:      Math.min(...inStockOffers.map(l => Number(l.priceAmount))).toFixed(2),
              highPrice:     Math.max(...inStockOffers.map(l => Number(l.priceAmount))).toFixed(2),
              priceCurrency: primaryCurrency,
              availability:  'https://schema.org/InStock',
            },
            // Per-retailer Offer items
            ...inStockOffers.map(l => ({
              '@type':        'Offer',
              price:          Number(l.priceAmount).toFixed(2),
              priceCurrency:  l.priceCurrency,
              availability:   'https://schema.org/InStock',
              url:            `${BASE_URL}/go/${l.id}`,
              seller: {
                '@type': 'Organization',
                name:    l.retailer.name,
              },
            })),
          ],
        }
      : {}),
  }

  // ── No-cover SVG placeholder ────────────────────────────────────────────────
  const NoCoverPlaceholder = ({ className }: { className?: string }) => (
    <div className={`flex flex-col items-center justify-center gap-2 bg-gray-100 text-gray-400 ${className ?? ''}`}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
      <span className="text-xs font-medium">No cover</span>
    </div>
  )

  return (
    <>
      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <main className="min-h-screen bg-[#F8F8F6] text-[#0A0A0A]">

        {/* ── Site header — shared Navbar component ─────────────────────── */}
        <Navbar />

        {/* ── Breadcrumb ─────────────────────────────────────────────────── */}
        <nav className="max-w-6xl mx-auto px-4 pt-4 pb-2 text-sm text-gray-500" aria-label="Breadcrumb">
          <Link href="/" className="hover:text-[#E8272A] transition-colors">Home</Link>
          <span className="mx-2 text-gray-300">/</span>
          <Link href="/search" className="hover:text-[#E8272A] transition-colors">Search</Link>
          <span className="mx-2 text-gray-300">/</span>
          <span className="text-gray-700 truncate">{product.title}</span>
        </nav>

        {/* ── Layout ───────────────────────────────────────────────────────
            Two-column on collected editions: [260px sidebar] [1fr main]
              — the issues grid promotes to a full-width section inside main
            Three-column on single issues:  [260px sidebar] [1fr main] [216px right]
              — the right column shows "More issues in this series" as side nav
            grid-template-columns is selected at render time via isCollectedEdition. */}
        <div className={`max-w-6xl mx-auto px-4 py-4 lg:grid lg:gap-10 lg:items-start ${
          isCollectedEdition
            ? 'lg:grid-cols-[260px_1fr]'
            : 'lg:grid-cols-[260px_1fr_240px]'
        }`}>

          {/* ── SIDEBAR (lg+ LEFT rail) ─────────────────────────────────
              "You might also like" — related collected editions / siblings.
              On SINGLE_ISSUE pages, sibling issues live in the right column,
              not here, so this sidebar shows only related products. */}
          <aside className="hidden lg:block" aria-label="Related titles">
            <div className="sticky top-20">

              {related.length > 0 && (
                <div className="mb-6">
                  <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.12em] mb-3 px-1">You might also like</h2>
                  <div className="flex flex-col">
                    {related.map(r => (
                      <Link
                        key={r.id}
                        href={`/product/${r.canonicalSlug}`}
                        className="group flex items-center gap-3.5 rounded-lg px-2 py-2 hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-[#E8272A] focus:ring-offset-1"
                      >
                        <div className="flex-shrink-0 w-[60px] h-[84px] rounded overflow-hidden bg-gray-100 shadow-sm">
                          {r.coverImageUrl && !isBadCoverUrl(r.coverImageUrl) ? (
                            <Image src={r.coverImageUrl} alt={r.title} width={60} height={84}
                              className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-200" />
                          ) : (
                            <NoCoverPlaceholder className="w-full h-full" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold text-gray-900 line-clamp-3 group-hover:text-[#E8272A] transition-colors leading-snug">
                            {r.title}
                          </p>
                          {r.publisher && (
                            <p className="text-[11px] text-gray-400 mt-1">{r.publisher}</p>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* On COLLECTED-EDITION pages the "Issues in this series" sidebar
                  panel is removed — those issues are promoted to a full-width
                  gallery in the main column ("Inside this collection"). The
                  sidebar would just be a duplicate.  On SINGLE_ISSUE pages
                  there's no sidebar issues block either — they live in the
                  right column as a sticky side nav. */}

            </div>
          </aside>

          {/* ── MAIN COLUMN ─────────────────────────────────────────────── */}
          <div className="min-w-0">

            {/* ── Section 1: Hero ───────────────────────────────────────
                Editorial hero — large cover (320×480 desktop, 260×390 mobile)
                anchors the page. Metadata flows right of the cover with format
                in small-caps tracking, prominent title, then series/publisher/
                creator credits, then full description. */}
            <section className="mb-10">
              <div className="flex flex-col sm:flex-row gap-6 sm:gap-10">

                {/* Cover — bigger than before for editorial weight */}
                <div className="flex-shrink-0 mx-auto sm:mx-0">
                  <CVCoverImage
                    dbCoverUrl={product.coverImageUrl}
                    comicvineId={product.comicvineId}
                    title={product.title}
                    sizes="(min-width: 640px) 320px, 260px"
                    priority
                    className="w-[260px] h-[390px] sm:w-[320px] sm:h-[480px] rounded-xl shadow-lg"
                  />
                </div>

                {/* Metadata column */}
                <div className="flex-1 min-w-0">
                  {/* Format treatment — small-caps tracking, no chip, sits as
                      eyebrow above the title with publisher dot-separated. */}
                  <p className="text-[11px] font-bold text-[#E8272A] uppercase tracking-[0.14em] mb-3">
                    {FORMAT_LABELS[product.format] ?? product.format}
                    {product.publisher && (
                      <span className="text-gray-400 font-bold"> · {product.publisher}</span>
                    )}
                  </p>

                  {/* Series (when distinct from title) */}
                  {product.seriesName && product.seriesName !== product.title && (
                    <p className="text-sm text-gray-500 mb-2">
                      {product.seriesName}
                      {product.volumeNumber ? ` · Vol. ${product.volumeNumber}` : ''}
                      {product.issueNumber  ? ` · #${product.issueNumber}`      : ''}
                    </p>
                  )}

                  <h1 className="text-3xl sm:text-4xl font-bold text-[#0A0A0A] leading-tight mb-2">
                    {product.title}
                  </h1>

                  {product.subtitle && (
                    <p className="text-lg text-gray-500 mb-4">{product.subtitle}</p>
                  )}

                  {/* Creators — populated by CV enrichment (cv_metadata.creators)
                      Rendered as "WRITER  Name1, Name2  ·  ARTIST  Name3" rows */}
                  {orderedCreators.length > 0 && (
                    <div className="mb-4 space-y-1">
                      {orderedCreators.slice(0, 4).map(({ role, names }) => (
                        <div key={role} className="flex items-baseline gap-3 text-sm">
                          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.12em] w-[64px] flex-shrink-0">
                            {role}
                          </span>
                          <span className="text-gray-800">{names.slice(0, 4).join(', ')}{names.length > 4 ? '…' : ''}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Release + ISBN — compact line */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500 mb-4">
                    {product.releaseDate && (
                      <span>Released <span className="text-gray-800 font-medium">{fmtDate(product.releaseDate)}</span></span>
                    )}
                    {product.isbn13 && (
                      <span className="text-xs text-gray-400">ISBN <span className="font-mono text-gray-600">{product.isbn13}</span></span>
                    )}
                  </div>

                  {/* Description — full text on collected editions (rich CV
                      synopses unlock here), clamped on single issues to avoid
                      eating the page. Prefers cv_metadata.synopsis when richer. */}
                  {displayDescription && (
                    <p className={`text-gray-700 text-[15px] leading-relaxed ${
                      isCollectedEdition ? '' : 'line-clamp-4'
                    }`}>
                      {displayDescription}
                    </p>
                  )}

                  {/* Character tags — fetched live from Comic Vine */}
                  {product.comicvineId && (
                    <CVCharacterTags comicvineId={product.comicvineId} />
                  )}
                </div>
              </div>
            </section>

            {/* ── Section 2: Best offer ───────────────────────────────── */}
            {bestListing && (
              <section className="mb-8">
                <div className="rounded-2xl bg-white border-l-4 border-[#E8272A] shadow-sm p-6">
                  <p className="text-xs text-[#E8272A] uppercase tracking-widest font-semibold mb-2">
                    Best price
                  </p>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div>
                      <p className="text-4xl font-bold text-[#0A0A0A]">
                        {fmtPrice(Number(bestListing.priceAmount), bestListing.priceCurrency)}
                      </p>
                      {bestListing.shippingAmount !== null && (
                        <p className="text-sm text-gray-500 mt-0.5">
                          {Number(bestListing.shippingAmount) === 0
                            ? '+ Free shipping'
                            : `+ ${fmtPrice(Number(bestListing.shippingAmount), bestListing.priceCurrency)} shipping`}
                        </p>
                      )}
                      <p className="text-sm text-gray-500 mt-1">
                        from <span className="text-gray-800 font-medium">{bestListing.retailer.name}</span>
                        {' · '}
                        {bestListing.condition === 'NEW' ? 'New' : bestListing.condition.replace(/_/g, ' ')}
                      </p>
                    </div>
                    <div className="sm:ml-auto">
                      <a
                        href={`/go/${bestListing.id}`}
                        target="_blank"
                        rel="noopener noreferrer sponsored"
                        className="inline-block px-6 py-3 rounded-xl bg-[#E8272A] hover:bg-[#c41f22] text-white font-semibold text-base transition-colors focus:outline-none focus:ring-2 focus:ring-[#E8272A] focus:ring-offset-2"
                      >
                        Buy at {bestListing.retailer.name} ↗
                      </a>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* ── Section 3: All offers ───────────────────────────────── */}
            {/* eBay BIN listings fetched client-side, merged by OffersTable */}
            <section className="mb-8">
              <h2 className="text-xl font-semibold text-[#0A0A0A] mb-4">
                Price comparison
                <span className="ml-2 text-sm font-normal text-gray-400">
                  ({offers.length} listing{offers.length !== 1 ? 's' : ''})
                </span>
              </h2>
              <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
                {offers.length === 0 ? (
                  <p className="text-gray-500 text-sm">No retailer listings tracked yet for this title.</p>
                ) : null}
                <OffersTable
                  offers={offers}
                  isbn13={product.isbn13 ?? null}
                  productTitle={product.title}
                  canonicalProductId={product.id}
                />
              </div>
            </section>

            {/* ── Section 3c: Also available at (dynamic-link retailers) */}
            {dynamicLinks.length > 0 && (
              <section className="mb-8">
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">
                  Also available at
                </h2>
                <div className="flex flex-wrap gap-3">
                  {dynamicLinks.map(l => (
                    <a
                      key={l.id}
                      href={`/go/${l.id}`}
                      target="_blank"
                      rel="noopener noreferrer sponsored"
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-gray-200 hover:border-[#E8272A] hover:text-[#E8272A] text-gray-700 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[#E8272A] focus:ring-offset-1"
                    >
                      {l.retailer.name}
                      <span className="text-gray-400 text-xs">Check price ↗</span>
                    </a>
                  ))}
                </div>
              </section>
            )}

            {/* ── Section 4: Price history ────────────────────────────── */}
            <section className="mb-8">
              <h2 className="text-xl font-semibold text-[#0A0A0A] mb-4">Price history</h2>
              <div className="bg-white rounded-xl p-4 border border-gray-200">
                <Suspense fallback={<div className="h-40 animate-pulse bg-gray-100 rounded" />}>
                  <PriceSparkline points={sparkPoints} currency={primaryCurrency} />
                </Suspense>
              </div>
            </section>

            {/* ── Section 5: Inside this collection ─────────────────────
                COLLECTED EDITIONS ONLY. Full-width editorial gallery of every
                issue this volume reprints. The "umbrella → nested" relationship
                lives here — large covers (~150 px each), 6 columns on desktop,
                horizontal scroller on mobile.  CVIssuesGrid resolves its own
                issue list from CV via the volume id we pass.  Renders nothing
                if CV returns no issues (silent collapse). */}
            {isCollectedEdition && (
              <section className="mb-10">
                {/* Desktop: 6-col grid. Hidden on mobile (the horizontal
                    scroller below takes over). */}
                <div className="hidden md:block">
                  <CVIssuesGrid
                    comicvineId={cvVolumeId}
                    searchTitle={product.seriesName ?? product.title}
                    productSlug={slug}
                    comicTitle={product.seriesName ?? product.title}
                    label="Inside this collection"
                    columns={6}
                  />
                </div>
                {/* Mobile: same component but 3 columns (wider thumbnails) */}
                <div className="md:hidden">
                  <CVIssuesGrid
                    comicvineId={cvVolumeId}
                    searchTitle={product.seriesName ?? product.title}
                    productSlug={slug}
                    comicTitle={product.seriesName ?? product.title}
                    label="Inside this collection"
                    columns={3}
                  />
                </div>
              </section>
            )}

            {/* ── Mobile: related (below main; lg+ uses sidebar)
                Issues for collected editions appear in the "Inside this
                collection" section above, so mobile here only needs related. */}
            {related.length > 0 && (
              <section className="mb-8 lg:hidden">
                <h2 className="text-lg font-semibold text-[#0A0A0A] mb-4">You might also like</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {related.map(r => (
                    <Link key={r.id} href={`/product/${r.canonicalSlug}`}
                      className="group block rounded-lg overflow-hidden hover:opacity-95 transition-opacity focus:outline-none focus:ring-2 focus:ring-[#E8272A] focus:ring-offset-1">
                      <div className="aspect-[2/3] bg-gray-100 rounded-lg overflow-hidden shadow-sm">
                        {r.coverImageUrl && !isBadCoverUrl(r.coverImageUrl) ? (
                          <Image src={r.coverImageUrl} alt={r.title} width={200} height={300}
                            className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200" />
                        ) : (
                          <NoCoverPlaceholder className="w-full h-full" />
                        )}
                      </div>
                      <p className="text-[12px] font-semibold text-gray-900 line-clamp-2 group-hover:text-[#E8272A] transition-colors mt-2 px-0.5">{r.title}</p>
                      {r.publisher && <p className="text-[10px] text-gray-400 mt-0.5 px-0.5">{r.publisher}</p>}
                    </Link>
                  ))}
                </div>
              </section>
            )}

          </div>{/* end main column */}

          {/* ── RIGHT COLUMN: SINGLE_ISSUE pages only ────────────────────
              For single-issue product pages, the issues grid is sideways
              navigation ("more in this series") — sticky narrow panel works.
              Collected editions don't render this column (their issues are
              promoted to the full-width "Inside this collection" section). */}
          {!isCollectedEdition && (
            <div className="hidden lg:block" style={{ position: 'sticky', top: '80px' }}>
              <CVIssuesGrid
                comicvineId={cvVolumeId}
                searchTitle={product.seriesName ?? product.title}
                productSlug={slug}
                comicTitle={product.seriesName ?? product.title}
                label="More issues in this series"
                columns={3}
              />
            </div>
          )}

        </div>{/* end layout grid */}

      </main>
    </>
  )
}
