/**
 * app/robots.ts — robots.txt for Catch Comics
 *
 * Next.js serves this at /robots.txt automatically.
 * Allow all crawlers; point at every sitemap.
 *
 * The product pages are split across /product/sitemap/{id}.xml because one
 * file could not hold them — see lib/seo/sitemap-chunks.ts. Listing each
 * chunk here is how a crawler finds them all without a sitemap index
 * document, which the Next.js metadata API does not produce.
 *
 * Blocked paths:
 *   /admin/*  — admin UI, never indexed
 *   /api/*    — API routes, no crawl value + rate-limit risk
 *   /go/*     — affiliate redirect routes, avoid duplicate-URL issues
 */

import type { MetadataRoute } from 'next'
import { BASE_URL } from '@/lib/site-url'
import { productSitemapCount, productSitemapUrls } from '@/lib/seo/sitemap-chunks'


export default async function robots(): Promise<MetadataRoute.Robots> {
  const chunks = await productSitemapCount()

  return {
    rules: {
      userAgent: '*',
      allow:     '/',
      disallow:  ['/admin/', '/api/', '/go/'],
    },
    sitemap: [`${BASE_URL}/sitemap.xml`, ...productSitemapUrls(chunks)],
  }
}
