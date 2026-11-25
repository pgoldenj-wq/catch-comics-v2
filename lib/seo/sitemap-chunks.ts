/**
 * lib/seo/sitemap-chunks.ts — how the product sitemap is split.
 *
 * A sitemap may hold 50,000 URLs and 50 MB uncompressed. One file listing
 * every canonical product passed both: 136,296 URLs and 26.7 MB on
 * 2026-11-22. A sitemap over the limit is rejected whole, so none of those
 * product pages was being submitted — on a catalogue-first site that is the
 * whole point of the file.
 *
 * 45,000 leaves headroom for the catalogue to grow between deployments
 * without a chunk tipping over the line mid-month.
 *
 * One place owns the maths so app/sitemap.ts, app/product/sitemap.ts and
 * app/robots.ts cannot disagree about how many chunks exist.
 */

import { prisma }   from '@/lib/prisma'
import { BASE_URL } from '@/lib/site-url'

export const PRODUCTS_PER_SITEMAP = 45_000

/** How many product sitemaps the current catalogue needs. Always at least 1. */
export async function productSitemapCount(): Promise<number> {
  try {
    const total = await prisma.canonicalProduct.count({ where: { deletedAt: null } })
    return Math.max(1, Math.ceil(total / PRODUCTS_PER_SITEMAP))
  } catch (err) {
    // Same instinct as the sitemap route itself: one valid chunk beats a
    // broken file. The next revalidation picks the rest back up.
    console.error('[sitemap-chunks] count failed — assuming a single chunk:', err)
    return 1
  }
}

/** Absolute URLs of every product sitemap, for robots.txt to advertise. */
export function productSitemapUrls(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${BASE_URL}/product/sitemap/${i}.xml`)
}
