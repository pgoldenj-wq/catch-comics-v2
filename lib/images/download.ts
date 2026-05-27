/**
 * Cover image download + R2 upload pipeline for Catch Comics.
 *
 * downloadAndStoreCover():
 *   1. Skip if already on R2
 *   2. Download from external CDN (10s timeout, 5MB cap)
 *   3. Process with sharp → WebP 400px max-width, quality 85
 *   4. Upload to R2 at covers/{productId}.webp
 *   5. Update canonical_products.cover_image_url
 *   6. Return new R2 URL, or null on any failure (never throws)
 */

import { PutObjectCommand }  from '@aws-sdk/client-s3'
import sharp                  from 'sharp'
import { prisma }             from '../prisma'
import { r2Client, R2_BUCKET, R2_PUBLIC_URL } from './r2'

const MAX_BYTES   = 5 * 1024 * 1024   // 5 MB
const MAX_WIDTH   = 400
const WEBP_Q      = 85
const TIMEOUT_MS  = 10_000

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
      headers: {
        'User-Agent': 'CatchComics/1.0 (+https://catchcomics.com)',
        'Referer':    'https://catchcomics.com',
      },
    })

    if (!res.ok) {
      console.warn(`[r2] Download failed ${res.status}: ${fetchUrl}`)
      return null
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) {
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
