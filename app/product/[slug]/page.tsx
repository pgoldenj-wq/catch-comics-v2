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
    amazonOffer = await Promise.race([
      lookupAmazon(product.isbn13, product.id, 'amazon.co.uk'),
      new Promise<null>(resolve => setTimeout(() => resolve(null), 800)),
    ])
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

        {/* ── Layout: LEFT sidebar + main content + optional RIGHT CV issues col ── */}
        {/* Third column appears when the product has a comicvineId so we can        */}
        {/* fetch and display the issue-by-issue grid from Comic Vine.               */}
        <div className="max-w-6xl mx-auto px-4 py-4 lg:grid lg:gap-10 lg:items-start lg:grid-cols-[260px_1fr_216px]">

          {/* ── SIDEBAR: Related + single issues (lg+ only, LEFT rail) ───── */}
          <aside className="hidden lg:block" aria-label="Related titles">
            <div className="sticky top-20">

              {/* Related collected editions */}
              {related.length > 0 && (
                <div className="mb-6">
                  <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">You might also like</h2>
                  <div className="flex flex-col gap-2">
                    {related.map(r => (
                      <Link
                        key={r.id}
                        href={`/product/${r.canonicalSlug}`}
                        className="group flex items-center gap-3 bg-white rounded-xl border border-gray-200 hover:border-[#E8272A]/50 hover:shadow-sm p-3 transition-all focus:outline-none focus:ring-2 focus:ring-[#E8272A] focus:ring-offset-1"
                      >
                        <div className="flex-shrink-0 w-12 h-[68px] rounded-lg overflow-hidden">
                          {r.coverImageUrl ? (
                            <Image src={r.coverImageUrl} alt={r.title} width={48} height={68}
                              className="w-full h-full object-cover group-hover:opacity-90 transition-opacity" />
                          ) : (
                            <NoCoverPlaceholder className="w-full h-full rounded-lg" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-900 line-clamp-3 group-hover:text-[#E8272A] transition-colors leading-snug">
                            {r.title}
                          </p>
                          {r.publisher && (
                            <p className="text-[10px] text-gray-400 mt-1">{r.publisher}</p>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Single issues in this series */}
              {singleIssues.length > 0 && (
                <div>
                  <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Issues in this series</h2>
                  <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto pr-1">
                    {singleIssues.map(issue => (
                      <Link
                        key={issue.id}
                        href={`/product/${issue.canonicalSlug}`}
                        className="group flex items-center gap-3 bg-white rounded-xl border border-gray-200 hover:border-[#E8272A]/50 hover:shadow-sm p-2.5 transition-all focus:outline-none focus:ring-2 focus:ring-[#E8272A] focus:ring-offset-1"
                      >
                        <div className="flex-shrink-0 w-10 h-14 rounded overflow-hidden bg-gray-100">
                          {issue.coverImageUrl ? (
                            <Image src={issue.coverImageUrl} alt={issue.title} width={40} height={56}
                              className="w-full h-full object-cover group-hover:opacity-90 transition-opacity" />
                          ) : (
                            <NoCoverPlaceholder className="w-full h-full" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-900 line-clamp-2 group-hover:text-[#E8272A] transition-colors leading-snug">
                            {issue.issueNumber ? `#${issue.issueNumber}` : issue.title}
                          </p>
                          {issue.releaseDate && (
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              {new Date(issue.releaseDate).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                            </p>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

            </div>
          </aside>

          {/* ── MAIN COLUMN ─────────────────────────────────────────────── */}
          <div className="min-w-0">

            {/* ── Section 1: Hero ─────────────────────────────────────── */}
            <section className="mb-8">
              <div className="flex flex-col sm:flex-row gap-8">

                {/* Cover image — CVCoverImage handles DB cover → live CV fallback → placeholder */}
                <div className="flex-shrink-0">
                  <CVCoverImage
                    dbCoverUrl={product.coverImageUrl}
                    comicvineId={product.comicvineId}
                    title={product.title}
                    className="w-[180px] h-[270px] sm:w-[200px] sm:h-[300px] rounded-xl shadow-md"
                  />
                </div>

                {/* Metadata */}
                <div className="flex-1 min-w-0">
                  {/* Format badge */}
                  <span className="inline-block px-2.5 py-1 rounded-full text-xs font-semibold bg-[#E8272A]/10 text-[#E8272A] mb-3">
                    {FORMAT_LABELS[product.format] ?? product.format}
                  </span>

                  {/* Series */}
                  {product.seriesName && (
                    <p className="text-sm text-gray-500 mb-1">
                      {product.seriesName}
                      {product.volumeNumber ? ` · Vol. ${product.volumeNumber}` : ''}
                      {product.issueNumber  ? ` · #${product.issueNumber}`      : ''}
                    </p>
                  )}

                  <h1 className="text-3xl sm:text-4xl font-bold text-[#0A0A0A] leading-tight mb-1">
                    {product.title}
                  </h1>

                  {product.subtitle && (
                    <p className="text-lg text-gray-500 mb-3">{product.subtitle}</p>
                  )}

                  {/* Publisher + release date */}
                  <div className="flex flex-wrap gap-4 text-sm text-gray-500 mb-4">
                    {product.publisher && (
                      <span>Published by <span className="text-gray-800 font-medium">{product.publisher}</span></span>
                    )}
                    {product.releaseDate && (
                      <span>Released <span className="text-gray-800 font-medium">{fmtDate(product.releaseDate)}</span></span>
                    )}
                  </div>

                  {/* ISBNs */}
                  {(product.isbn13 || product.isbn10) && (
                    <div className="flex flex-wrap gap-3 text-xs text-gray-400 mb-4">
                      {product.isbn13 && <span>ISBN-13: <span className="font-mono text-gray-600">{product.isbn13}</span></span>}
                      {product.isbn10 && <span>ISBN-10: <span className="font-mono text-gray-600">{product.isbn10}</span></span>}
                    </div>
                  )}

                  {/* Description */}
                  {product.description && (
                    <p className="text-gray-600 text-sm leading-relaxed line-clamp-4">
                      {product.description}
                    </p>
                  )}

                  {/* Character tags — fetched live from Comic Vine when available */}
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

            {/* ── Mobile: related + single issues (below main, lg+ uses sidebar) */}
            {(related.length > 0 || singleIssues.length > 0) && (
              <section className="mb-8 lg:hidden">
                {related.length > 0 && (
                  <>
                    <h2 className="text-lg font-semibold text-[#0A0A0A] mb-4">You might also like</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                      {related.map(r => (
                        <Link key={r.id} href={`/product/${r.canonicalSlug}`}
                          className="group block rounded-xl overflow-hidden bg-white border border-gray-200 hover:border-[#E8272A]/50 hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-[#E8272A] focus:ring-offset-1">
                          {r.coverImageUrl ? (
                            <Image src={r.coverImageUrl} alt={r.title} width={200} height={280}
                              className="w-full object-cover aspect-[2/3] group-hover:opacity-90 transition-opacity" />
                          ) : (
                            <NoCoverPlaceholder className="aspect-[2/3] w-full" />
                          )}
                          <div className="p-2.5">
                            <p className="text-xs font-medium text-gray-900 line-clamp-2 group-hover:text-[#E8272A] transition-colors">{r.title}</p>
                            {r.publisher && <p className="text-[10px] text-gray-400 mt-0.5">{r.publisher}</p>}
                          </div>
                        </Link>
                      ))}
                    </div>
                  </>
                )}
                {singleIssues.length > 0 && (
                  <>
                    <h2 className="text-lg font-semibold text-[#0A0A0A] mb-4">Issues in this series</h2>
                    <div className="flex flex-col gap-2">
                      {singleIssues.slice(0, 8).map(issue => (
                        <Link key={issue.id} href={`/product/${issue.canonicalSlug}`}
                          className="group flex items-center gap-3 bg-white rounded-xl border border-gray-200 hover:border-[#E8272A]/50 p-3 transition-all focus:outline-none focus:ring-2 focus:ring-[#E8272A] focus:ring-offset-1">
                          <div className="flex-shrink-0 w-10 h-14 rounded overflow-hidden bg-gray-100">
                            {issue.coverImageUrl ? (
                              <Image src={issue.coverImageUrl} alt={issue.title} width={40} height={56}
                                className="w-full h-full object-cover group-hover:opacity-90 transition-opacity" />
                            ) : (
                              <NoCoverPlaceholder className="w-full h-full" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 line-clamp-2 group-hover:text-[#E8272A] transition-colors">
                              {issue.issueNumber ? `#${issue.issueNumber}` : issue.title}
                            </p>
                            {issue.releaseDate && (
                              <p className="text-xs text-gray-400 mt-0.5">
                                {new Date(issue.releaseDate).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                              </p>
                            )}
                          </div>
                        </Link>
                      ))}
                    </div>
                  </>
                )}
              </section>
            )}

          </div>{/* end main column */}

          {/* ── RIGHT COLUMN: CV issues grid (lg+, always mounted) ──────────────
              CVIssuesGrid resolves its own volume ID:
                1. comicvineId from DB (instant)
                2. Title search via /api/comic/search (fallback — also self-heals DB)
              Renders nothing when no issues are found, so the column is invisible.
              Hidden on mobile — related titles appear in the left sidebar instead. */}
          <div className="hidden lg:block" style={{ position: 'sticky', top: '80px' }}>
            <CVIssuesGrid
              comicvineId={product.comicvineId}
              searchTitle={product.title}
              productSlug={slug}
              comicTitle={product.title}
            />
          </div>

        </div>{/* end layout grid */}

      </main>
    </>
  )
}
