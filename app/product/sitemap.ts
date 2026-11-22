/**
 * app/product/sitemap.ts — the canonical product pages, in chunks.
 *
 * Next.js serves these at /product/sitemap/{id}.xml, one file per chunk, and
 * app/robots.ts advertises every one of them. They used to live in the single
 * /sitemap.xml, which had grown to 136,296 URLs and 26.7 MB — both past the
 * 50,000-URL and 50 MB limits, so the file was rejected whole and no product
 * page reached a crawler through it.
 *
 * Ordered by updatedAt so recently-changed products sit in the low-numbered
 * chunks, which is where a crawler starts.
 *
 * Revalidates every 24 hours (ISR). Re-runs on each Vercel deployment.
 */

import type { MetadataRoute }                            from 'next'
import { prisma }                                        from '@/lib/prisma'
import { BASE_URL }                                      from '@/lib/site-url'
import { PRODUCTS_PER_SITEMAP, productSitemapCount }     from '@/lib/seo/sitemap-chunks'

export const revalidate = 86_400 // 24 hours

export async function generateSitemaps(): Promise<{ id: number }[]> {
  const count = await productSitemapCount()
  return Array.from({ length: count }, (_, id) => ({ id }))
}

export default async function sitemap(
  props: { id: Promise<string> | string },
): Promise<MetadataRoute.Sitemap> {
  const id = Number(await props.id)
  if (!Number.isInteger(id) || id < 0) return []

  try {
    const products = await prisma.canonicalProduct.findMany({
      where:   { deletedAt: null },
      select:  { canonicalSlug: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      skip:    id * PRODUCTS_PER_SITEMAP,
      take:    PRODUCTS_PER_SITEMAP,
    })

    return products.map(p => ({
      url:              `${BASE_URL}/product/${p.canonicalSlug}`,
      lastModified:     p.updatedAt,
      changeFrequency:  'weekly' as const,
      priority:         0.7,
    }))
  } catch (err) {
    // An empty chunk is a valid sitemap; a half-written one is not.
    console.error(`[sitemap] product chunk ${id} failed:`, err)
    return []
  }
}
