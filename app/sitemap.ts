/**
 * app/sitemap.ts — Dynamic sitemap for Catch Comics
 *
 * Returns static routes + all canonical product pages.
 * Next.js serves this at /sitemap.xml automatically.
 *
 * Revalidates every 24 hours (ISR). Re-runs on each Vercel deployment.
 */

import type { MetadataRoute }             from 'next'
import { prisma }                          from '@/lib/prisma'
import { getAllSeriesSlugs }               from '@/lib/series/registry'

export const revalidate = 86_400 // 24 hours

const BASE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://catchcomics.com').replace(/\/$/, '')

// ── Static pages ──────────────────────────────────────────────────────────────

const STATIC_ROUTES: MetadataRoute.Sitemap = [
  {
    url:              `${BASE_URL}/`,
    lastModified:     new Date(),
    changeFrequency:  'daily',
    priority:         1.0,
  },
  {
    url:              `${BASE_URL}/search`,
    lastModified:     new Date(),
    changeFrequency:  'weekly',
    priority:         0.8,
  },
  {
    url:              `${BASE_URL}/series`,
    lastModified:     new Date(),
    changeFrequency:  'weekly',
    priority:         0.9,
  },
  ...getAllSeriesSlugs().map(slug => ({
    url:              `${BASE_URL}/series/${slug}`,
    lastModified:     new Date(),
    changeFrequency:  'weekly' as const,
    priority:         0.85,
  })),
]

// ── Dynamic product pages ─────────────────────────────────────────────────────

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    // Fetch all canonical slugs — ordered by updatedAt so recently-changed
    // products appear near the top of the sitemap (helps crawl prioritisation).
    const products = await prisma.canonicalProduct.findMany({
      select:  { canonicalSlug: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    })

    const productRoutes: MetadataRoute.Sitemap = products.map(p => ({
      url:              `${BASE_URL}/product/${p.canonicalSlug}`,
      lastModified:     p.updatedAt,
      changeFrequency:  'weekly' as const,
      priority:         0.7,
    }))

    return [...STATIC_ROUTES, ...productRoutes]

  } catch (err) {
    // On DB failure, return only static routes — better than a broken sitemap
    console.error('[sitemap] DB error — returning static routes only:', err)
    return STATIC_ROUTES
  }
}
