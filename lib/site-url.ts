/**
 * BASE_URL — the single origin every self-referential URL is built from:
 * canonical links, og:url, og:image, twitter:image, sitemap.xml, robots.txt.
 *
 * It MUST name the host that actually answers 200. Catch Comics serves at
 * https://www.catchcomics.com; the bare apex 308-redirects there. Until
 * 2026-08-24 this constant was duplicated across eight files and defaulted to
 * the apex, so every share card and canonical tag pointed at a redirect rather
 * than at the live page (founder review 2026-08-24 — the og-image itself is a
 * valid 1200×630 PNG serving 200, only the declared URL was wrong).
 *
 * If the primary domain is ever flipped in Vercel so the apex serves and www
 * redirects, change it HERE (or set NEXT_PUBLIC_SITE_URL) — not in eight files.
 */
export const BASE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://www.catchcomics.com'
).replace(/\/$/, '')
