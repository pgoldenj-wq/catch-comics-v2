/**
 * Cover image download + R2 upload pipeline for Catch Comics.
 *
 * downloadAndStoreCover():
 *   1. Skip if already on R2
 *   2. Download from external CDN (10s timeout, 5MB cap)
 *      — uses browser-like headers to defeat anti-scraping (CV Cloudflare etc.)
 *   3. Process with sharp → WebP 1000px max-width, quality 85
 *   4. Upload to R2 at covers/{productId}.webp
 *   5. Update canonical_products.cover_image_url
 *   6. Return new R2 URL, or null on any failure (never throws)
 *
 * downloadAndStoreCoverWithFallback():
 *   Try multiple sources in priority order until one succeeds:
 *     1. Primary URL (CV / retailer-provided cover) with browser headers
 *     2. Open Library by ISBN-13
 *     3. Google Books by ISBN-13 (size-validated)
 *   Returns the R2 URL of whichever source worked, or null.
 */

import { PutObjectCommand }  from '@aws-sdk/client-s3'
import crypto                 from 'crypto'
import sharp                  from 'sharp'
import { prisma }             from '../prisma'
import { r2Client, R2_BUCKET, R2_PUBLIC_URL } from './r2'

const MAX_BYTES   = 5 * 1024 * 1024   // 5 MB
// 1000px wide captures the full resolution of our best free source — ISBN-keyed
// Shopify retailer images are ~975-1011px wide (1500px tall, the "_SL1500"
// variant). 400px was too low: it threw away that resolution and rendered soft
// when cards hover-zoom (~3x) or on retina. withoutEnlargement still prevents
// upscaling genuinely small sources. WebP q85 at ~1000x1500 ≈ 150-300KB.
const MAX_WIDTH   = 1000
const WEBP_Q      = 85
const TIMEOUT_MS  = 10_000

// Known placeholder graphics ("image not available" / "no cover") that some
// sources (Open Library default, Google Books "no preview") return as a
// real-sized image. They pass the dimension check but render as a placeholder.
// sha256[:16] of the processed WebP — captured by scripts/cover-r2-fullscan.ts.
// Guard below rejects them so we never bake one into R2 or overwrite a good
// cover with one. Add new signatures here if verify:covers surfaces more.
const PLACEHOLDER_HASHES = new Set<string>([
  '06661fd690879985', // Open Library "no cover" (3484b) — 15,313 occurrences
  '2cafc2b0f16dfe03', // Google Books "no preview" (4558b) — 9,414 occurrences
  '307a2fbbc46139a8', // misc placeholder (876b)
  'b3165c10e262603d', // misc placeholder (836b)
])

// Browser-like headers — defeats Cloudflare anti-scraping on CV and similar CDNs.
// Tested 2026-05-28: CV currently returns 200 to plain requests, but this is
// defensive against the documented late-2025 ComicVine Cloudflare tightening.
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':          'image/avif,image/webp,image/png,image/jpeg,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest':  'image',
  'Sec-Fetch-Mode':  'no-cors',
  'Sec-Fetch-Site':  'same-origin',
}

/** Pick the most appropriate referer for a given image host. */
function refererFor(url: string): string {
  if (url.includes('comicvine.gamespot.com')) return 'https://comicvine.gamespot.com/'
  if (url.includes('books.google.com'))       return 'https://books.google.com/'
  if (url.includes('covers.openlibrary.org')) return 'https://openlibrary.org/'
  return 'https://catchcomics.com'
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns true if the URL is already served from our R2 bucket. */
export function isAlreadyHosted(url: string | null | undefined): boolean {
  if (!url) return false
  return (
    url.includes('r2.dev') ||
    url.includes('cloudflarestorage.com') ||
    (!!R2_PUBLIC_URL && url.startsWith(R2_PUBLIC_URL))
  )
}

/** Upgrade ComicVine scale_small → scale_large for better quality. */
function upgradeComicVineUrl(url: string): string {
  if (url.includes('comicvine.gamespot.com') || url.includes('comicvine.com')) {
    return url.replace(/\/scale_small\//g, '/scale_large/')
  }
  return url
}

// ── Core function ─────────────────────────────────────────────────────────────

export async function downloadAndStoreCover(
  canonicalProductId: string,
  sourceUrl:           string,
): Promise<string | null> {
  try {
    // Skip if already on R2
    if (isAlreadyHosted(sourceUrl)) return sourceUrl

    const fetchUrl = upgradeComicVineUrl(sourceUrl)

    // ── Download ────────────────────────────────────────────────────────────
    const res = await fetch(fetchUrl, {
      signal:  AbortSignal.timeout(TIMEOUT_MS),
      headers: { ...BROWSER_HEADERS, 'Referer': refererFor(fetchUrl) },
    })

    if (!res.ok) {
      console.warn(`[r2] Download failed ${res.status}: ${fetchUrl}`)
      return null
    }

    const contentType = res.headers.get('content-type') ?? ''
    // Allow octet-stream — some CDNs (CV, S3) serve images with this type.
    // sharp will reject it if it turns out not to be a real image.
    const isImage = contentType.startsWith('image/') || contentType === 'application/octet-stream'
    if (!isImage) {
      console.warn(`[r2] Non-image content-type "${contentType}" for ${fetchUrl}`)
      return null
    }

    const buffer = Buffer.from(await res.arrayBuffer())

    if (buffer.byteLength > MAX_BYTES) {
      console.warn(`[r2] Image too large (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB): ${fetchUrl}`)
      return null
    }

    // ── Process with sharp ──────────────────────────────────────────────────
    // Reject tiny images (1×1 OL placeholders, corrupt files, etc.)
    const meta = await sharp(buffer).metadata()
    const { width = 0, height = 0 } = meta
    if (width < 50 || height < 50) {
      console.warn(`[r2] Image too small (${width}×${height}px) — skipping: ${fetchUrl}`)
      return null
    }

    const processed = await sharp(buffer)
      .resize(MAX_WIDTH, undefined, {
        fit:        'inside',
        withoutEnlargement: true,   // don't upscale small images
      })
      .webp({ quality: WEBP_Q })
      .toBuffer()

    // ── Placeholder guard ─────────────────────────────────────────────────
    // Reject byte-identical "image not available" / "no cover" graphics so we
    // never store a placeholder or overwrite an existing good cover with one.
    const sig = crypto.createHash('sha256').update(processed).digest('hex').slice(0, 16)
    if (PLACEHOLDER_HASHES.has(sig)) {
      console.warn(`[r2] Rejected known placeholder image (sha ${sig}) for ${canonicalProductId}: ${fetchUrl}`)
      return null
    }

    // ── Upload to R2 ────────────────────────────────────────────────────────
    const key = `covers/${canonicalProductId}.webp`

    await r2Client.send(new PutObjectCommand({
      Bucket:      R2_BUCKET,
      Key:         key,
      Body:        processed,
      ContentType: 'image/webp',
    }))

    const r2Url = `${R2_PUBLIC_URL}/${key}`

    // ── Update DB ───────────────────────────────────────────────────────────
    await prisma.canonicalProduct.update({
      where: { id: canonicalProductId },
      data:  { coverImageUrl: r2Url, updatedAt: new Date() },
    })

    return r2Url

  } catch (err) {
    console.error(`[r2] Error storing cover for ${canonicalProductId} (${sourceUrl}):`, err)
    return null
  }
}

// ── Fallback chain ────────────────────────────────────────────────────────────
//
// downloadAndStoreCoverWithFallback() tries multiple sources in priority order.
// Used by the CV ingest script and any future enrichment job. First success wins
// — if none of the sources return a valid image, returns null and the product
// keeps its placeholder.

interface FallbackOpts {
  /** Comic Vine cover URL if known (tried first) */
  cvUrl?:    string | null
  /** ISBN-13 (no hyphens) — enables Open Library + Google Books fallbacks */
  isbn13?:   string | null
}

/**
 * Try CV → Open Library → Google Books in order. Returns the new R2 URL,
 * or null if none worked. Each source is attempted via downloadAndStoreCover()
 * so all images are validated by sharp (dimensions ≥ 50×50) and stored as WebP.
 */
export async function downloadAndStoreCoverWithFallback(
  canonicalProductId: string,
  opts:               FallbackOpts,
): Promise<string | null> {
  const sources: Array<{ name: string; url: string }> = []

  if (opts.cvUrl) {
    sources.push({ name: 'comicvine', url: opts.cvUrl })
  }

  if (opts.isbn13) {
    // Open Library — ?default=false makes it return 404 instead of a 1×1 GIF
    // when there's no cover for the ISBN.
    sources.push({
      name: 'openlibrary',
      url:  `https://covers.openlibrary.org/b/isbn/${opts.isbn13}-L.jpg?default=false`,
    })
    // Google Books — full URL with zoom 2 (medium); sharp's ≥50×50 check
    // rejects their tiny "no preview" placeholder if it slips through.
    sources.push({
      name: 'googlebooks',
      url:  `https://books.google.com/books/content?vid=ISBN${opts.isbn13}&printsec=frontcover&img=1&zoom=2&edge=curl`,
    })
  }

  for (const { name, url } of sources) {
    const result = await downloadAndStoreCover(canonicalProductId, url)
    if (result) {
      console.log(`[r2] Cover for ${canonicalProductId} sourced from ${name}`)
      return result
    }
  }

  return null
}
