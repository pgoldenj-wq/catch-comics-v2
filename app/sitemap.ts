/**
 * app/sitemap.ts — the static routes for Catch Comics.
 *
 * Next.js serves this at /sitemap.xml automatically.
 *
 * The product pages are NOT here. They outgrew a single file — 136,296 URLs
 * and 26.7 MB on 2026-11-22, past both the 50,000-URL and 50 MB limits, which
 * gets a sitemap rejected whole rather than trimmed. They now live in
 * app/product/sitemap.ts as chunks at /product/sitemap/{id}.xml, and
 * app/robots.ts advertises every chunk alongside this file.
 *
 * Revalidates every 24 hours (ISR). Re-runs on each Vercel deployment.
 */

import type { MetadataRoute }             from 'next'
import { getAllSeriesSlugs }               from '@/lib/series/registry'
import { BASE_URL } from '@/lib/site-url'

export const revalidate = 86_400 // 24 hours


// ── Static pages ──────────────────────────────────────────────────────────────

const STATIC_ROUTES: MetadataRoute.Sitemap = [
  {
    url:              `${BASE_URL}/`,
    lastModified:     new Date(),
    changeFrequency:  'daily',
    priority:         1.0,
  },
  // /search removed (LB-5, 2026-07-12): with no query the page is a search
  // start state, not indexable content — no crawl value.
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

export default function sitemap(): MetadataRoute.Sitemap {
  return STATIC_ROUTES
}
