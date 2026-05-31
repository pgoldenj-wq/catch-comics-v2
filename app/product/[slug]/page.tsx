/**
 * /product/[slug] — Product detail page (v1 redesign 2026-05-30).
 *
 * Layout (v1.1 — 2026-05-30):
 *   Section 1 — Dark hero band (#111827, matches homepage hero):
 *                 cover (160x240/180x270), title, series, "Collects N
 *                 issues", labeled rows for Format / Publisher / Release
 *                 Date / Creators / Status / Character Tags
 *   Section 2 — Single 3-column row (md+):
 *                 LEFT   IssueListGrid — vertical 2-col grid of issue
 *                        covers, 3x bouncy center-origin hover scale,
 *                        Next.js <Link> per card
 *                 CENTRE Price Comparison heading + Best Price pill,
 *                        OffersTable (unchanged data layer), Also
 *                        Available At chips, Price History sparkline
 *                 RIGHT  Description (full) + You Might Also Like cards
 *               Below 768px: collapses to single column in order
 *                 pricing → issues → description → related (via Tailwind
 *                 order- classes).
 *
 * Pricing layer, /go redirect, scoring, schema — all untouched.
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
import CVCoverImage                      from '@/components/CVCoverImage'
import IssueListGrid                     from '@/components/IssueListGrid'
import IssueCountLine                    from '@/components/IssueCountLine'
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

      <main className="min-h-screen bg-white text-[#0A0A0A]">

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

        {/* ── SECTION 1: Dark hero band ───────────────────────────────────
            Full-width band. Background colour #111827 matches the homepage
            hero card so the brand reads consistently across pages. Subtle
            red radial glow in the top-right echoes the homepage accent. */}
        <section className="relative bg-[#111827] text-white overflow-hidden">
          {/* Soft red glow — same recipe as the homepage hero accent */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-20 -right-20 w-[420px] h-[420px]"
            style={{ background: 'radial-gradient(circle, rgba(232,39,42,0.14) 0%, transparent 65%)' }}
          />
          <div className="relative max-w-6xl mx-auto px-4 py-8 sm:py-12">
            <div className="flex flex-col sm:flex-row gap-6 sm:gap-10 items-start">

              {/* Cover — medium-sized */}
              <div className="flex-shrink-0 mx-auto sm:mx-0">
                <CVCoverImage
                  dbCoverUrl={product.coverImageUrl}
                  comicvineId={product.comicvineId}
                  title={product.title}
                  sizes="(min-width: 640px) 180px, 160px"
                  priority
                  className="w-[160px] h-[240px] sm:w-[180px] sm:h-[270px] rounded-lg shadow-2xl"
                />
              </div>

              {/* Metadata column — uniform "Label: value" rows matching the
                  v1 mockup. Title + series + collects-count sit above the
                  labeled block as the editorial top of the hero. */}
              <div className="flex-1 min-w-0">
                {/* Title */}
                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white leading-tight mb-2">
                  {product.title}
                </h1>

                {/* Series subtitle (cleaned of trailing punctuation so a
                    series_name like "Absolute Batman," renders as
                    "Absolute Batman · Vol. 2" not "Absolute Batman, · Vol. 2") */}
                {product.seriesName && product.seriesName !== product.title && (() => {
                  const cleanSeries = product.seriesName.replace(/[,;:.\s]+$/, '').trim()
                  return (
                    <p className="text-sm text-white/60 mb-2">
                      {cleanSeries}
                      {product.volumeNumber ? ` · Vol. ${product.volumeNumber}` : ''}
                      {product.issueNumber  ? ` · #${product.issueNumber}`      : ''}
                    </p>
                  )
                })()}

                {/* "Collects N issues" — dark-bg variant via className prop */}
                <IssueCountLine
                  comicvineId={cvVolumeId}
                  searchTitle={product.seriesName ?? product.title}
                  enabled={isCollectedEdition}
                  className="text-[13px] text-white/60 mt-1 mb-5"
                />

                {/* Labeled metadata rows — uniform "Label: value" format.
                    Replaces the previous mix of chip + scattered key-values. */}
                <dl className="space-y-1.5 text-sm">
                  <LabeledRow label="Format" value={FORMAT_LABELS[product.format] ?? product.format} />
                  {product.publisher && (
                    <LabeledRow label="Publisher" value={product.publisher} />
                  )}
                  {product.releaseDate && (
                    <LabeledRow label="Release Date" value={fmtDate(product.releaseDate)} />
                  )}
                  {orderedCreators.length > 0 && (
                    <LabeledRow label="Creators">
                      <InlineCreators creators={orderedCreators} />
                    </LabeledRow>
                  )}
                  <LabeledRow label="Status" value={statusLabel(bestListing)} />
                  {product.comicvineId && (
                    <LabeledRow label="Character Tags">
                      <CVCharacterTags comicvineId={product.comicvineId} darkBg />
                    </LabeledRow>
                  )}
                </dl>
              </div>
            </div>
          </div>
        </section>

        {/* ── SECTION 2: Single 3-column content row ────────────────────────
            Three columns on md+ (768px and above):
              [240px LEFT  ] IssueListGrid — 2-col vertical issue covers
              [1fr   CENTRE] Price Comparison + OffersTable + history
              [320px RIGHT ] Description + You Might Also Like

            Below md: collapses to a single column.  Source order is issues
            → pricing → description+YMAL, but Tailwind `order-` classes flip
            mobile to pricing → issues → description → related per spec. */}
        <section className="bg-white">
          <div className="max-w-6xl mx-auto px-4 py-10 sm:py-14">
            <div className="md:grid md:grid-cols-[240px_1fr_320px] md:gap-8 md:items-start">

              {/* LEFT — Issue grid (issues / collects).  order-2 on mobile
                  so pricing appears first, order-1 on md+ for left column. */}
              <div className="order-2 md:order-1 min-w-0 mt-10 md:mt-0">
                <IssueListGrid
                  comicvineId={cvVolumeId}
                  searchTitle={product.seriesName ?? product.title}
                  productSlug={slug}
                  comicTitle={product.seriesName ?? product.title}
                  label={isCollectedEdition ? 'Collects Issues' : 'Issues in this series'}
                  columns={2}
                  currentIssueId={product.format === 'SINGLE_ISSUE' ? product.comicvineId : null}
                />
              </div>

              {/* CENTRE — Price Comparison block.  order-1 on mobile (shows
                  first), order-2 on md+ for centre column. */}
              <div className="order-1 md:order-2 min-w-0">

                <div className="flex flex-wrap items-baseline justify-between gap-3 mb-5">
                  <h2 className="text-2xl font-bold text-[#0A0A0A]">
                    Price Comparison
                    <span className="ml-2 text-sm font-normal text-gray-400">
                      ({offers.length} listing{offers.length !== 1 ? 's' : ''})
                    </span>
                  </h2>
                  {bestListing && <BestPriceBadge />}
                </div>

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

                {dynamicLinks.length > 0 && (
                  <div className="mt-8">
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400 mb-3">
                      Also Available At
                    </h3>
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
                  </div>
                )}

                <div className="mt-10">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400 mb-3">
                    Price History
                  </h3>
                  <div className="bg-white rounded-xl p-4 border border-gray-200">
                    <Suspense fallback={<div className="h-40 animate-pulse bg-gray-100 rounded" />}>
                      <PriceSparkline points={sparkPoints} currency={primaryCurrency} />
                    </Suspense>
                  </div>
                </div>

              </div>

              {/* RIGHT — Description + You Might Also Like.  order-3 always
                  (last on both mobile and desktop). */}
              <aside className="order-3 mt-10 md:mt-0 space-y-8">
                <div>
                  <h2 className="text-xl font-semibold text-[#0A0A0A] mb-3">
                    Description
                  </h2>
                  {displayDescription ? (
                    <p className="text-[14px] text-gray-700 leading-relaxed">
                      {displayDescription}
                    </p>
                  ) : (
                    <p className="text-[13px] text-gray-400 italic">
                      No description available.
                    </p>
                  )}
                  {product.isbn13 && (
                    <p className="mt-3 text-[11px] text-gray-400">
                      ISBN <span className="font-mono text-gray-600">{product.isbn13}</span>
                    </p>
                  )}
                </div>

                {related.length > 0 && (
                  <div>
                    <h2 className="text-xl font-semibold text-[#0A0A0A] mb-3">
                      You Might Also Like
                    </h2>
                    <div className="grid grid-cols-2 md:grid-cols-1 gap-3">
                      {related.slice(0, 4).map(r => (
                        <RelatedCard key={r.id} r={r} />
                      ))}
                    </div>
                  </div>
                )}
              </aside>

            </div>
          </div>
        </section>


      </main>
    </>
  )
}

// ── Helper components for the v1 redesign hero + sections ───────────────────

/** "Field: value" labeled row used throughout the dark hero metadata block.
 *  Pass `value` as a string OR drop arbitrary JSX as children. The label
 *  column is fixed-width on sm+ so values align in a clean column. Label
 *  weight is full-bold white to match the mockup's contrast level. */
function LabeledRow({ label, value, children }: {
  label: string
  value?: string | null
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3">
      <dt className="text-white font-bold text-sm sm:w-[120px] sm:flex-shrink-0">
        {label}:
      </dt>
      <dd className="text-white/85 text-sm min-w-0 flex-1">
        {children ?? value ?? ''}
      </dd>
    </div>
  )
}

/** Inline creators line — "Writer: [A] Scott Snyder | Artist: [B] Greg Capullo"
 *  Sits inside a LabeledRow as the value. Avatars are colored initials
 *  (no real photos in cv_metadata). */
function InlineCreators({ creators }: { creators: Array<{ role: string; names: string[] }> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1.5">
      {creators.slice(0, 3).map(({ role, names }, i) => {
        const primary = names[0] ?? ''
        const initial = (primary[0] || '?').toUpperCase()
        const extra   = names.length > 1 ? ` +${names.length - 1}` : ''
        const hue     = [...primary].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % 360
        const roleLabel = role.charAt(0).toUpperCase() + role.slice(1)
        return (
          <span key={role} className="inline-flex items-center gap-1.5">
            {i > 0 && <span className="text-white/30 mx-1">|</span>}
            <span className="text-white/60">{roleLabel}:</span>
            <span
              className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold text-white"
              style={{ background: `hsl(${hue}, 45%, 38%)` }}
              aria-hidden="true"
            >
              {initial}
            </span>
            <span className="text-white">{primary}{extra && <span className="text-white/50">{extra}</span>}</span>
          </span>
        )
      })}
    </span>
  )
}

/** Status string derived from the best current listing's stock — fed into
 *  the LabeledRow as plain text (no chip, no dot, matches mockup spec). */
function statusLabel(bestListing: { stockStatus: string } | null | undefined): string {
  switch (bestListing?.stockStatus) {
    case 'IN_STOCK':     return 'In Stock'
    case 'LOW_STOCK':    return 'Low Stock'
    case 'PREORDER':     return 'Pre-order'
    case 'OUT_OF_STOCK': return 'Out of Stock'
    default:             return 'Check Availability'
  }
}

/** Small card used in the "You Might Also Like" sidebar — cover thumb +
 *  title + format/publisher line. Inline no-cover SVG to avoid pulling
 *  the page's local NoCoverPlaceholder. */
function RelatedCard({ r }: {
  r: { id: string; title: string; coverImageUrl: string | null; canonicalSlug: string; format: string; publisher: string | null }
}) {
  const fmt = FORMAT_LABELS[r.format] ?? r.format
  return (
    <Link
      href={`/product/${r.canonicalSlug}`}
      className="group flex gap-3 rounded-lg p-2 -mx-2 hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-[#E8272A] focus:ring-offset-1"
    >
      <div className="flex-shrink-0 w-[56px] h-[80px] rounded overflow-hidden bg-gray-100 shadow-sm">
        {r.coverImageUrl && !isBadCoverUrl(r.coverImageUrl) ? (
          <Image
            src={r.coverImageUrl}
            alt={r.title}
            width={56}
            height={80}
            className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-200"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-gray-900 line-clamp-2 group-hover:text-[#E8272A] transition-colors leading-snug">
          {r.title}
        </p>
        <p className="text-[10px] text-gray-400 mt-1 uppercase tracking-[0.1em] font-medium">
          {fmt}
          {r.publisher && <span> · {r.publisher}</span>}
        </p>
      </div>
    </Link>
  )
}

/** Red "Best Price" pill for the Price Comparison heading — matches the
 *  mockup spec exactly: just the label, no embedded price (the price lives
 *  in the table row beneath, so duplicating it here adds noise). */
function BestPriceBadge() {
  return (
    <span className="inline-flex items-center px-3.5 py-1.5 rounded-full bg-[#E8272A] text-white text-[12px] font-bold uppercase tracking-[0.08em] shadow-sm">
      Best Price
    </span>
  )
}
