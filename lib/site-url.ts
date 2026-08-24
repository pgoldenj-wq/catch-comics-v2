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
 * TWO LEVERS, and the env var wins:
 *   - Vercel Production pins NEXT_PUBLIC_SITE_URL = https://www.catchcomics.com
 *     (set 2026-08-24; it previously pinned the apex, which is why editing the
 *     code default alone would not have changed production).
 *   - Preview has no env var and falls through to the default below.
 * If the primary domain is ever flipped in Vercel so the apex serves and www
 * redirects, change BOTH — the fallback here and the Production env var.
 */
export const BASE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://www.catchcomics.com'
).replace(/\/$/, '')
