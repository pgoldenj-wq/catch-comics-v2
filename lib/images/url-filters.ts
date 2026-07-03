/**
 * Shared cover image URL filters.
 *
 * Some cover sources (Comic Vine system assets, Google Books "no preview"
 * placeholders, Open Library 1×1 GIFs) serve images that LOOK valid at the
 * HTTP layer (200, real dimensions) but render as placeholder graphics in
 * the UI. We filter these at the URL level so the designed fallback shows
 * instead.
 *
 * Three call sites used to duplicate this logic — product hero (CVCoverImage),
 * Top Deals carousel, and search results. Extracting here ensures every
 * surface (related cards, issue grid, sidebars) applies the same rules.
 */

/**
 * Returns true if the URL is a known placeholder / "no image available"
 * source that should not be rendered as a cover.
 *
 * Filters:
 *   - Comic Vine system assets:   /uploads/{anything}/0/{numeric}/   (user-id 0)
 *   - Comic Vine legacy markers:  contains "no_image"
 *   - Comic Vine current markers: contains "image_not_available" / "not_available"
 *   - Google Books:                full books.google.com URLs (their "no preview"
 *                                 placeholder is a real-sized JPEG, undetectable
 *                                 at the pixel level — easier to drop the host)
 *   - Open Library (direct):       bare covers.openlibrary.org hotlinks. OL serves
 *                                 a 1×1 transparent GIF (HTTP 200) for any ISBN it
 *                                 lacks — indistinguishable from a real cover at the
 *                                 URL level, and it renders blank while suppressing
 *                                 every fallback. Real OL covers are downloaded to
 *                                 R2 at ingest, so a bare OL URL in a cover field is
 *                                 always either dead or a fragile hotlink — never
 *                                 render it directly. (See scripts/fix-dead-ol-covers.ts.)
 */
export function isBadCoverUrl(url: string | null | undefined): boolean {
  if (!url) return true
  const u = url.toLowerCase()
  if (u.includes('no_image'))                return true
  if (u.includes('image_not_available'))     return true
  if (u.includes('not_available'))           return true
  if (/\/uploads\/[^/]+\/0\/\d+\//.test(u)) return true   // CV system placeholder
  if (u.includes('books.google.com'))        return true   // GB "no preview" JPEG
  if (u.includes('covers.openlibrary.org'))  return true   // OL direct: 1×1 dead GIF / fragile hotlink
  if (u.includes('productserve.com'))        return true   // AWIN image proxy: 200×200 white-letterboxed
                                                           // retailer thumbs — not covers. Also crashes
                                                           // next/image in dev (host not in remotePatterns).
  return false
}

/**
 * next/image is only safe for hosts allowlisted in next.config.ts →
 * images.remotePatterns. Feeding it any other host throws in dev and 400s
 * via /_next/image in production (broken image). Cover URLs come from the
 * DB and can contain retailer/proxy hosts — always branch to a raw <img>
 * when this returns false. Keep the list in sync with next.config.ts.
 */
const NEXT_IMAGE_HOSTS = [
  'images.catchcomics.com',
  'r2.dev',                    // *.r2.dev + pub-*.r2.dev legacy
  'books.google.com',
  'covers.openlibrary.org',
  'comicvine.gamespot.com',
  'images-eu.bookshop.org',
]
export function canUseNextImage(url: string | null | undefined): boolean {
  if (!url) return false
  return NEXT_IMAGE_HOSTS.some(h => url.includes(h))
}

/**
 * Open Library serves a 1×1 transparent GIF (HTTP 200) when an ISBN isn't in
 * its cover database. Appending ?default=false makes OL return 404 instead,
 * which lets <img onError> + the letter-initial fallback fire correctly.
 *
 * Note: isBadCoverUrl() now rejects bare covers.openlibrary.org URLs from cover
 * fields, so in normal rendering an OL URL never reaches here. This remains as
 * defence-in-depth for the few intentional static OL fallbacks that bypass the
 * filter — if one slips through, ?default=false guarantees onError fires rather
 * than a silent blank 1×1.
 */
export function adjustImgSrc(url: string): string {
  if (url.includes('covers.openlibrary.org')) {
    return url + (url.includes('?') ? '&default=false' : '?default=false')
  }
  return url
}
