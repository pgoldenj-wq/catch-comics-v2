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

  const [related, dynamicLinks] = await Promise.all([
    getRelated(product.id, product.seriesName, product.publisher, product.format),
    getDynamicLinks(product.id),
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
  const inStockOffers = allListings.filter(l => IN_STOCK_STATUSES.has(l.stockStatus))
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type':    'Product',
    name:       product.title,
    ...(product.description  ? { description: product.description }  : {}),
    ...(product.coverImageUrl ? { image: product.coverImageUrl }     : {}),
    ...(product.isbn13       ? { isbn: product.isbn13 }              : {}),
    ...(product.publisher    ? { brand: { '@type': 'Brand', name: product.publisher } } : {}),
    ...(inStockOffers.length > 0
      ? {
          offers: {
            '@type':       'AggregateOffer',
            offerCount:    inStockOffers.length,
            lowPrice:      Math.min(...inStockOffers.map(l => Number(l.priceAmount))).toFixed(2),
            highPrice:     Math.max(...inStockOffers.map(l => Number(l.priceAmount))).toFixed(2),
            priceCurrency: primaryCurrency,
            availability:  'https://schema.org/InStock',
          },
        }
      : {}),
  }

  return (
    <>
      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <main className="min-h-screen bg-gray-950 text-gray-100">

        {/* ── Breadcrumb ─────────────────────────────────────────────────── */}
        <nav className="max-w-5xl mx-auto px-4 pt-6 pb-2 text-sm text-gray-500">
          <Link href="/" className="hover:text-gray-300">Home</Link>
          <span className="mx-2">/</span>
          <Link href="/search" className="hover:text-gray-300">Search</Link>
          <span className="mx-2">/</span>
          <span className="text-gray-300 truncate">{product.title}</span>
        </nav>

        {/* ── Section 1: Hero ───────────────────────────────────────────── */}
        <section className="max-w-5xl mx-auto px-4 py-8">
          <div className="flex flex-col sm:flex-row gap-8">

            {/* Cover image */}
            <div className="flex-shrink-0">
              {product.coverImageUrl ? (
                <Image
                  src={product.coverImageUrl}
                  alt={`Cover of ${product.title}`}
                  width={200}
                  height={300}
                  className="rounded-lg shadow-2xl object-cover"
                  priority
                />
              ) : (
                <div className="w-[200px] h-[300px] rounded-lg bg-gray-800 flex items-center justify-center text-gray-600 text-sm">
                  No cover
                </div>
              )}
            </div>

            {/* Metadata */}
            <div className="flex-1 min-w-0">
              {/* Format badge */}
              <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-indigo-900 text-indigo-300 mb-3">
                {FORMAT_LABELS[product.format] ?? product.format}
              </span>

              {/* Series */}
              {product.seriesName && (
                <p className="text-sm text-gray-400 mb-1">
                  {product.seriesName}
                  {product.volumeNumber ? ` · Vol. ${product.volumeNumber}` : ''}
                  {product.issueNumber  ? ` · #${product.issueNumber}`      : ''}
                </p>
              )}

              <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight mb-1">
                {product.title}
              </h1>

              {product.subtitle && (
                <p className="text-lg text-gray-400 mb-3">{product.subtitle}</p>
              )}

              {/* Publisher + release date */}
              <div className="flex flex-wrap gap-4 text-sm text-gray-400 mb-4">
                {product.publisher && (
                  <span>Published by <span className="text-gray-200">{product.publisher}</span></span>
                )}
                {product.releaseDate && (
                  <span>Released <span className="text-gray-200">{fmtDate(product.releaseDate)}</span></span>
                )}
              </div>

              {/* ISBNs */}
              {(product.isbn13 || product.isbn10) && (
                <div className="flex flex-wrap gap-3 text-xs text-gray-500 mb-4">
                  {product.isbn13 && <span>ISBN-13: <span className="font-mono text-gray-400">{product.isbn13}</span></span>}
                  {product.isbn10 && <span>ISBN-10: <span className="font-mono text-gray-400">{product.isbn10}</span></span>}
                </div>
              )}

              {/* Description */}
              {product.description && (
                <p className="text-gray-400 text-sm leading-relaxed line-clamp-4">
                  {product.description}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ── Section 2: Best offer ─────────────────────────────────────── */}
        {bestListing && (
          <section className="max-w-5xl mx-auto px-4 pb-8">
            <div className="rounded-2xl bg-gradient-to-r from-indigo-900/50 to-indigo-800/30 border border-indigo-700/40 p-6">
              <p className="text-xs text-indigo-300 uppercase tracking-widest font-semibold mb-1">
                Best price
              </p>
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div>
                  <p className="text-4xl font-bold text-white">
                    {fmtPrice(Number(bestListing.priceAmount), bestListing.priceCurrency)}
                  </p>
                  {bestListing.shippingAmount !== null && (
                    <p className="text-sm text-gray-400 mt-0.5">
                      {Number(bestListing.shippingAmount) === 0
                        ? '+ Free shipping'
                        : `+ ${fmtPrice(Number(bestListing.shippingAmount), bestListing.priceCurrency)} shipping`}
                    </p>
                  )}
                  <p className="text-sm text-gray-400 mt-1">
                    from <span className="text-gray-200">{bestListing.retailer.name}</span>
                    {' · '}
                    {bestListing.condition === 'NEW' ? 'New' : bestListing.condition.replace(/_/g, ' ')}
                  </p>
                </div>
                <div className="sm:ml-auto">
                  <a
                    href={`/go/${bestListing.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-base transition-colors"
                  >
                    Buy at {bestListing.retailer.name} ↗
                  </a>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ── Section 3: All offers ─────────────────────────────────────── */}
        {/* eBay Buy-It-Now listings are fetched client-side and merged      */}
        {/* inline by OffersTable — no visual segregation, marketplace rows  */}
        {/* carry an eBay badge and postage disclaimer.                      */}
        <section className="max-w-5xl mx-auto px-4 pb-12">
          <h2 className="text-xl font-semibold text-white mb-4">
            Price comparison
            <span className="ml-2 text-sm font-normal text-gray-500">
              ({offers.length} listing{offers.length !== 1 ? 's' : ''})
            </span>
          </h2>
          {offers.length === 0 ? (
            <p className="text-gray-500 mb-4">No retailer listings tracked yet for this title.</p>
          ) : null}
          <OffersTable
            offers={offers}
            isbn13={product.isbn13 ?? null}
            productTitle={product.title}
            canonicalProductId={product.id}
          />
        </section>

        {/* ── Section 3c: Also available at (dynamic-link retailers) ──── */}
        {dynamicLinks.length > 0 && (
          <section className="max-w-5xl mx-auto px-4 pb-8">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-widest mb-3">
              Also available at
            </h2>
            <div className="flex flex-wrap gap-3">
              {dynamicLinks.map(l => (
                <a
                  key={l.id}
                  href={`/go/${l.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-900 border border-gray-800 hover:border-indigo-600 hover:text-indigo-300 text-gray-300 text-sm font-medium transition-colors"
                >
                  {l.retailer.name}
                  <span className="text-gray-600 text-xs">Check price ↗</span>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* ── Section 4: Price history ──────────────────────────────────── */}
        <section className="max-w-5xl mx-auto px-4 pb-12">
          <h2 className="text-xl font-semibold text-white mb-4">Price history</h2>
          <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
            <Suspense fallback={<div className="h-40 animate-pulse bg-gray-800 rounded" />}>
              <PriceSparkline points={sparkPoints} currency={primaryCurrency} />
            </Suspense>
          </div>
        </section>

        {/* ── Section 5: Related products ───────────────────────────────── */}
        {related.length > 0 && (
          <section className="max-w-5xl mx-auto px-4 pb-16">
            <h2 className="text-xl font-semibold text-white mb-4">You might also like</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {related.map(r => (
                <Link
                  key={r.id}
                  href={`/product/${r.canonicalSlug}`}
                  className="group block rounded-xl overflow-hidden bg-gray-900 border border-gray-800 hover:border-indigo-600 transition-colors"
                >
                  {r.coverImageUrl ? (
                    <Image
                      src={r.coverImageUrl}
                      alt={r.title}
                      width={200}
                      height={280}
                      className="w-full object-cover aspect-[2/3] group-hover:opacity-90 transition-opacity"
                    />
                  ) : (
                    <div className="aspect-[2/3] bg-gray-800 flex items-center justify-center text-gray-600 text-xs p-2 text-center">
                      {r.title}
                    </div>
                  )}
                  <div className="p-3">
                    <p className="text-sm font-medium text-gray-200 line-clamp-2 group-hover:text-white transition-colors">
                      {r.title}
                    </p>
                    {r.publisher && (
                      <p className="text-xs text-gray-500 mt-0.5">{r.publisher}</p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

      </main>
    </>
  )
}
