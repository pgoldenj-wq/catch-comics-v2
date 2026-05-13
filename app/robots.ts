/**
 * app/robots.ts — robots.txt for Catch Comics
 *
 * Next.js serves this at /robots.txt automatically.
 * Allow all crawlers; point at the sitemap.
 *
 * Blocked paths:
 *   /admin/*  — admin UI, never indexed
 *   /api/*    — API routes, no crawl value + rate-limit risk
 *   /go/*     — affiliate redirect routes, avoid duplicate-URL issues
 */

import type { MetadataRoute } from 'next'

const BASE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://catchcomics.com').replace(/\/$/, '')

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow:     '/',
      disallow:  ['/admin/', '/api/', '/go/'],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  }
}
