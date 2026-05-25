/**
 * ISBN metadata enrichment service for Catch Comics.
 *
 * Sources (in priority order):
 *   1. Google Books API  — best for publisher, description, cover images
 *   2. Open Library API  — good fallback, especially for older/independent titles
 *
 * All API responses are cached in `metadata_cache` (30-day TTL).
 * Enrichment only fills null fields on CanonicalProduct — never overwrites.
 *
 * Rate limits:
 *   Google Books: 1 req/s without key, 20 req/s with key (1 000/day unauth)
 *   Open Library: 1 req/s (polite limit)
 */

import { prisma }         from '../prisma'
import { ProductFormat }  from '@prisma/client'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EnrichmentResult {
  isbn13          : string
  title           : string | null
  subtitle        : string | null
  publisher       : string | null
  releaseDate     : Date   | null
  description     : string | null
  coverImageUrl   : string | null
  format          : ProductFormat | null
  seriesName      : string | null
  volumeNumber    : number | null
  source          : 'google_books' | 'open_library' | 'none'
}

export interface EnrichmentSummary {
  processed  : number
  enriched   : number
  skipped    : number   // already fully enriched
  notFound   : number   // API returned no data
  errors     : number
}

// ── Rate limiter ──────────────────────────────────────────────────────────────

function makeRateLimiter(minIntervalMs: number): () => Promise<void> {
  let lastCall = 0
  return async () => {
    const now  = Date.now()
    const wait = minIntervalMs - (now - lastCall)
    if (wait > 0) await new Promise(r => setTimeout(r, wait))
    lastCall = Date.now()
  }
}

const waitGoogle = makeRateLimiter(
  process.env.GOOGLE_BOOKS_API_KEY ? 50 : 1000  // 20/s with key, 1/s without
)
const waitOpenLibrary = makeRateLimiter(1000)  // 1/s always

// ── Cache helpers ─────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000  // 30 days

async function readCache(source: string, isbn13: string): Promise<unknown | undefined> {
  const row = await prisma.metadataCache.findUnique({
    where: { source_isbn13: { source, isbn13 } },
  })
  if (!row) return undefined
  if (row.expiresAt < new Date()) return undefined  // expired
  // data is stored as { result: <payload> | null }
  const wrapper = row.data as { result: unknown }
  return wrapper.result  // may be null (cached "no data" response)
}

async function writeCache(source: string, isbn13: string, result: unknown): Promise<void> {
  const now       = new Date()
  const expiresAt = new Date(now.getTime() + CACHE_TTL_MS)
  // Prisma requires InputJsonValue; we go through JSON round-trip to satisfy the type checker.
  const data      = JSON.parse(JSON.stringify({ result })) as object
  await prisma.metadataCache.upsert({
    where : { source_isbn13: { source, isbn13 } },
    create: { source, isbn13, fetchedAt: now, expiresAt, data },
    update: { fetchedAt: now, expiresAt, data },
  })
}

// ── Google Books ──────────────────────────────────────────────────────────────

interface GBVolume {
  title         ?: string
  subtitle      ?: string
  authors       ?: string[]
  publisher     ?: string
  publishedDate ?: string
  description   ?: string
  imageLinks    ?: {
    thumbnail     ?: string
    small         ?: string
    medium        ?: string
    large         ?: string
    extraLarge    ?: string
  }
  industryIdentifiers ?: Array<{ type: string; identifier: string }>
}

function cleanGoogleCoverUrl(url: string | undefined): string | null {
  if (!url) return null
  return url
    .replace('http://', 'https://')   // upgrade to https
    .replace(/&edge=curl/g, '')        // remove curl edge effect
    .replace(/zoom=1/, 'zoom=2')       // prefer higher resolution
}

async function fetchGoogleBooks(isbn13: string): Promise<GBVolume | null> {
  const cached = await readCache('google_books', isbn13)
  if (cached !== undefined) return cached as GBVolume | null

  await waitGoogle()

  const key = process.env.GOOGLE_BOOKS_API_KEY
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn13}${key ? `&key=${key}` : ''}`

  const res = await fetch(url, {
    headers: { 'User-Agent': 'CatchComics/1.0 (pgoldenj@gmail.com)' },
    signal : AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    throw new Error(`Google Books API ${res.status} for ISBN ${isbn13}`)
  }

  const body = await res.json() as { totalItems?: number; items?: Array<{ volumeInfo: GBVolume }> }

  if (!body.totalItems || !body.items?.length) {
    await writeCache('google_books', isbn13, null)
    return null
  }

  const volume = body.items[0].volumeInfo
  await writeCache('google_books', isbn13, volume)
  return volume
}

function normalizeGoogleBooks(vol: GBVolume, isbn13: string): Partial<EnrichmentResult> {
  const coverUrl = cleanGoogleCoverUrl(
    vol.imageLinks?.extraLarge ??
    vol.imageLinks?.large       ??
    vol.imageLinks?.medium      ??
    vol.imageLinks?.small       ??
    vol.imageLinks?.thumbnail
  )

  let releaseDate: Date | null = null
  if (vol.publishedDate) {
    // publishedDate may be "2023", "2023-04", or "2023-04-15"
    const d = new Date(
      vol.publishedDate.length === 4
        ? `${vol.publishedDate}-01-01`
        : vol.publishedDate.length === 7
          ? `${vol.publishedDate}-01`
          : vol.publishedDate
    )
    if (!isNaN(d.getTime())) releaseDate = d
  }

  return {
    isbn13,
    title        : vol.title       ?? null,
    subtitle     : vol.subtitle    ?? null,
    publisher    : vol.publisher   ?? null,
    releaseDate,
    description  : vol.description ?? null,
    coverImageUrl: coverUrl,
    source       : 'google_books',
  }
}

// ── Open Library ──────────────────────────────────────────────────────────────

interface OLEntry {
  title       ?: string
  subtitle    ?: string
  publishers  ?: Array<{ name: string }>
  publish_date?: string
  notes       ?: string | { value: string }
  cover       ?: { small?: string; medium?: string; large?: string }
}

async function fetchOpenLibrary(isbn13: string): Promise<OLEntry | null> {
  const cached = await readCache('open_library', isbn13)
  if (cached !== undefined) return cached as OLEntry | null

  await waitOpenLibrary()

  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn13}&format=json&jscmd=data`

  const res = await fetch(url, {
    headers: { 'User-Agent': 'CatchComics/1.0 (pgoldenj@gmail.com)' },
    signal : AbortSignal.timeout(10_000),
  })

  if (!res.ok) {
    throw new Error(`Open Library API ${res.status} for ISBN ${isbn13}`)
  }

  const body   = await res.json() as Record<string, OLEntry>
  const key    = `ISBN:${isbn13}`
  const entry  = body[key] ?? null

  await writeCache('open_library', isbn13, entry)
  return entry
}

function normalizeOpenLibrary(entry: OLEntry, isbn13: string): Partial<EnrichmentResult> {
  let releaseDate: Date | null = null
  if (entry.publish_date) {
    const d = new Date(entry.publish_date)
    if (!isNaN(d.getTime())) releaseDate = d
  }

  // Cover: prefer OL's large, fall back to canonical CDN URL
  const coverUrl =
    entry.cover?.large  ??
    entry.cover?.medium ??
    entry.cover?.small  ??
    `https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg`

  let description: string | null = null
  if (entry.notes) {
    description = typeof entry.notes === 'string'
      ? entry.notes
      : entry.notes.value ?? null
  }

  return {
    isbn13,
    title        : entry.title              ?? null,
    subtitle     : entry.subtitle           ?? null,
    publisher    : entry.publishers?.[0]?.name ?? null,
    releaseDate,
    description,
    coverImageUrl: coverUrl,
    source       : 'open_library',
  }
}

// ── Format inference ──────────────────────────────────────────────────────────

export function inferFormat(title: string, subtitle?: string | null): ProductFormat | null {
  const combined = `${title} ${subtitle ?? ''}`.toLowerCase()

  if (/\bomnibus\b/.test(combined))                    return ProductFormat.OMNIBUS
  if (/\bdeluxe\b/.test(combined))                     return ProductFormat.DELUXE
  if (/\babsolute\b/.test(combined))                   return ProductFormat.ABSOLUTE
  if (/\bcompendium\b/.test(combined))                 return ProductFormat.COMPENDIUM
  if (/\b(manga|vol\.?\s*\d|volume\s*\d)/.test(combined) &&
      /\b(manga|seinen|shonen|shojo|josei)\b/.test(combined))
                                                        return ProductFormat.MANGA_VOLUME
  if (/\bhardcover\b|\bhc\b/.test(combined))           return ProductFormat.HARDCOVER
  if (/\btrade\s*paperback\b|\btpb\b|\bvol\.?\s*\d|\bvolume\s*\d/.test(combined))
                                                        return ProductFormat.TPB
  if (/\b#\d+\b|issue\s*\d+/.test(combined))          return ProductFormat.SINGLE_ISSUE

  return null
}

// ── Series/volume extraction ──────────────────────────────────────────────────

export interface SeriesVolume {
  seriesName   : string | null
  volumeNumber : number | null
}

export function extractSeriesVolume(title: string): SeriesVolume {
  // Patterns like:
  //   "Batman: Vol. 1 Their Dark Designs"
  //   "Saga Volume 3"
  //   "The Walking Dead, Book 5"
  const volMatch = title.match(
    /\b(?:vol(?:ume)?\.?\s*|book\s+)(\d+)\b/i
  )

  const volumeNumber = volMatch ? parseInt(volMatch[1], 10) : null

  // Series name = everything before "Vol"/"Volume"/"Book N"
  let seriesName: string | null = null
  if (volMatch?.index !== undefined) {
    seriesName = title
      .slice(0, volMatch.index)
      .replace(/[:\-,]+$/, '')  // strip trailing punctuation
      .trim() || null
  }

  return { seriesName, volumeNumber }
}

// ── Core enrichment ───────────────────────────────────────────────────────────
//
// Source priority for comics (updated — previously Google Books was first):
//
//   1. Open Library  — community-maintained comic database, better cover
//                      coverage for comics than Google Books.
//   2. Google Books  — fills gaps for publisher/description/date only;
//                      its cover images are NOT stored (frequently placeholder).
//
// Note: Comic Vine covers are the highest priority overall, but they are
// populated by a separate dedicated script (scripts/enrich-cv-covers.ts)
// because CV requires title-based matching rather than a simple ISBN lookup.
// applyEnrichment() will not overwrite a CV cover with an OL/GB one because
// it only fills null fields.

export async function enrichByIsbn(isbn13: string): Promise<EnrichmentResult> {
  let partial: Partial<EnrichmentResult> | null = null

  // ── Step 1: Open Library (better comic cover coverage) ───────────────────
  try {
    const olData = await fetchOpenLibrary(isbn13)
    if (olData) {
      partial = { ...normalizeOpenLibrary(olData, isbn13), source: 'open_library' }
    }
  } catch (err) {
    console.warn(`[enrich] Open Library failed for ${isbn13}:`, err)
  }

  // ── Step 2: Google Books — fills any gaps EXCEPT cover image ─────────────
  // Google Books serves full-size placeholder JPEGs for comics it doesn't
  // have previews for — indistinguishable from real covers client-side.
  // We use GB for publisher/description/date only, never for coverImageUrl.
  const needsDescription = !partial?.description
  const needsPublisher   = !partial?.publisher
  const needsDate        = !partial?.releaseDate

  if (!partial || needsDescription || needsPublisher || needsDate) {
    try {
      const gbData = await fetchGoogleBooks(isbn13)
      if (gbData) {
        const gbPartial = normalizeGoogleBooks(gbData, isbn13)
        if (!partial) {
          // Use GB as base but blank the cover — GB covers are unreliable for comics
          partial = { ...gbPartial, coverImageUrl: null, source: 'google_books' }
        } else {
          // Merge metadata only — never overwrite OL cover with GB cover
          if (needsDescription && gbPartial.description) partial.description = gbPartial.description
          if (needsPublisher   && gbPartial.publisher)   partial.publisher   = gbPartial.publisher
          if (needsDate        && gbPartial.releaseDate) partial.releaseDate = gbPartial.releaseDate
        }
      }
    } catch (err) {
      console.warn(`[enrich] Google Books failed for ${isbn13}:`, err)
    }
  }

  if (!partial) {
    return {
      isbn13, title: null, subtitle: null, publisher: null,
      releaseDate: null, description: null, coverImageUrl: null,
      format: null, seriesName: null, volumeNumber: null,
      source: 'none',
    }
  }

  // Infer format + series/volume from title
  const title    = partial.title    ?? ''
  const subtitle = partial.subtitle ?? null
  const format   = inferFormat(title, subtitle)
  const { seriesName, volumeNumber } = extractSeriesVolume(title)

  return {
    isbn13,
    title        : partial.title         ?? null,
    subtitle,
    publisher    : partial.publisher     ?? null,
    releaseDate  : partial.releaseDate   ?? null,
    description  : partial.description  ?? null,
    coverImageUrl: partial.coverImageUrl ?? null,
    format,
    seriesName,
    volumeNumber,
    source       : partial.source as EnrichmentResult['source'] ?? 'none',
  }
}

// ── Apply enrichment to DB ────────────────────────────────────────────────────

export async function applyEnrichment(
  productId : string,
  result    : EnrichmentResult,
): Promise<boolean> {
  if (result.source === 'none') return false

  const product = await prisma.canonicalProduct.findUnique({
    where : { id: productId },
    select: {
      description   : true,
      coverImageUrl : true,
      publisher     : true,
      releaseDate   : true,
      subtitle      : true,
      seriesName    : true,
      volumeNumber  : true,
    },
  })

  if (!product) return false

  // Build update — only fill null fields (never overwrite)
  const update: Record<string, unknown> = {}
  if (product.description   == null && result.description)   update.description   = result.description
  if (product.coverImageUrl == null && result.coverImageUrl) update.coverImageUrl = result.coverImageUrl
  if (product.publisher     == null && result.publisher)     update.publisher     = result.publisher
  if (product.releaseDate   == null && result.releaseDate)   update.releaseDate   = result.releaseDate
  if (product.subtitle      == null && result.subtitle)      update.subtitle      = result.subtitle
  if (product.seriesName    == null && result.seriesName)    update.seriesName    = result.seriesName
  if (product.volumeNumber  == null && result.volumeNumber !== null) {
    update.volumeNumber = result.volumeNumber
  }

  if (Object.keys(update).length === 0) return false  // nothing to update

  await prisma.canonicalProduct.update({ where: { id: productId }, data: update })
  return true
}

// ── Bulk enrichment ───────────────────────────────────────────────────────────

export async function enrichPendingProducts(
  batchSize  = 50,
  noCacheMode = false,
): Promise<EnrichmentSummary> {
  const summary: EnrichmentSummary = {
    processed: 0, enriched: 0, skipped: 0, notFound: 0, errors: 0,
  }

  // Products with ISBN that are missing description OR cover image
  const products = await prisma.canonicalProduct.findMany({
    where: {
      isbn13     : { not: null },
      OR: [
        { description  : null },
        { coverImageUrl: null },
      ],
    },
    select: { id: true, isbn13: true, title: true },
    take  : batchSize,
  })

  for (const product of products) {
    summary.processed++
    try {
      if (noCacheMode) {
        await prisma.$executeRaw`
          UPDATE metadata_cache
          SET expires_at = NOW() - INTERVAL '1 second'
          WHERE isbn_13 = ${product.isbn13!}
        `
      }
      const result = await enrichByIsbn(product.isbn13!)
      if (result.source === 'none') {
        summary.notFound++
        continue
      }
      const updated = await applyEnrichment(product.id, result)
      if (updated) {
        summary.enriched++
      } else {
        summary.skipped++
      }
    } catch (err) {
      summary.errors++
      console.error(`[enrich] Error enriching ${product.isbn13} ("${product.title}"):`, err)
    }
  }

  return summary
}
