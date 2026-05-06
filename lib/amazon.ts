/**
 * Amazon affiliate URL builder — Catch Comics
 *
 * Pure helper — no env imports. Callers supply the associate tag:
 *   • Client components: process.env.NEXT_PUBLIC_AMAZON_UK_ASSOCIATE_TAG
 *   • Server routes:     process.env.AMAZON_UK_ASSOCIATE_TAG
 *
 * Amazon associate tags are NOT secrets — they appear in every affiliate URL
 * visible to users. NEXT_PUBLIC_ is therefore safe and correct for client use.
 *
 * UK first. US is wired and ready; just set NEXT_PUBLIC_AMAZON_US_ASSOCIATE_TAG.
 *
 * ── PA API future architecture ────────────────────────────────────────────────
 * When 10 qualifying sales unlock the Product Advertising API 5.0:
 *
 * New env vars needed (server-side only — these ARE secrets):
 *   AMAZON_PA_ACCESS_KEY=
 *   AMAZON_PA_SECRET_KEY=
 *   AMAZON_PA_UK_ASSOCIATE_TAG=
 *   AMAZON_PA_US_ASSOCIATE_TAG=
 *
 * New file: app/api/amazon-prices/route.ts
 *   → calls PA API SearchItems with Keywords param
 *   → returns { listings: AmazonListing[] } with real prices, ASINs, images
 *   → cached in pricesCache under key  amazon:{region}:{query}
 *
 * PricingPanel change: merge AmazonListing[] into the priced listings section
 * (above the "Also search on" divider), sorted by price alongside eBay results.
 * The affiliate fallback links below stay as-is — they become supplementary.
 *
 * Nothing in the current affiliate layer needs to change when PA API arrives.
 */

export type AmazonRegion = 'uk' | 'us'

/** Loose union — covers PricingPanel formatFilter values and TOP_DEALS format strings */
export type ComicFormat =
  | 'all'
  | 'manga'
  | 'graphic-novel'
  | 'single-issue'
  | 'omnibus'
  | 'hardcover'
  | 'Manga'
  | 'Graphic Novel'
  | 'Hardcover'
  | 'Omnibus'
  | string
  | undefined

// Maps format values to a suffix that improves Amazon search precision.
// Manga-specific suffix prevents comic-book singles from dominating results.
function formatSuffix(format: ComicFormat): string {
  if (!format) return 'comic'
  const f = format.toLowerCase()
  if (f.includes('manga'))                               return 'manga'
  if (f.includes('omnibus'))                             return 'omnibus'
  if (f.includes('hardcover'))                           return 'hardcover'
  if (f.includes('graphic') || f.includes('tpb'))       return 'graphic novel'
  if (f === 'single-issue' || f === 'single issue')      return 'comic book'
  return 'comic'
}

/**
 * Build an Amazon search URL for a comic title.
 *
 * @param title  - Comic title as it appears on Catch Comics (e.g. "Saga Vol. 1")
 * @param region - 'uk' → amazon.co.uk, 'us' → amazon.com
 * @param format - Optional format hint ('manga', 'graphic-novel', etc.) for suffix
 * @param tag    - Associate tag from env var. If empty, URL is returned without &tag.
 *
 * @example
 * buildAmazonUrl({ title: 'One Piece Vol. 1', region: 'uk', format: 'manga', tag: 'mytag-21' })
 * // → https://www.amazon.co.uk/s?k=One+Piece+Vol.+1+manga&tag=mytag-21
 */
export function buildAmazonUrl(params: {
  title:   string
  region:  AmazonRegion
  format?: ComicFormat
  tag:     string
}): string {
  const { title, region, format, tag } = params
  const suffix     = formatSuffix(format)
  const searchTerm = `${title.trim()} ${suffix}`
  const domain     = region === 'uk' ? 'amazon.co.uk' : 'amazon.com'
  const base       = `https://www.${domain}/s?k=${encodeURIComponent(searchTerm)}`
  return tag ? `${base}&tag=${encodeURIComponent(tag)}` : base
}

/**
 * Build an Amazon search URL from a pre-composed optimised query string.
 * Use this when you already have a well-formed search term (e.g. TOP_DEALS.searchQuery).
 *
 * @example
 * buildAmazonUrlFromQuery({ query: 'Absolute Batman Vol 1 Hardcover', region: 'uk', tag: 'mytag-21' })
 */
export function buildAmazonUrlFromQuery(params: {
  query:  string
  region: AmazonRegion
  tag:    string
}): string {
  const { query, region, tag } = params
  const domain = region === 'uk' ? 'amazon.co.uk' : 'amazon.com'
  const base   = `https://www.${domain}/s?k=${encodeURIComponent(query.trim())}`
  return tag ? `${base}&tag=${encodeURIComponent(tag)}` : base
}
