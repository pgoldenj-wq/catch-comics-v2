/**
 * AbeBooks affiliate URL builder — Catch Comics
 *
 * ── Live pricing API status ───────────────────────────────────────────────────
 * AbeBooks (owned by Amazon) does NOT offer a public live-pricing REST API.
 * Their Partner Search API requires a signed commercial partnership agreement —
 * it is not a self-serve API key. No workaround exists for indie developers.
 *
 * ── What IS available ─────────────────────────────────────────────────────────
 * Direct search links to abebooks.co.uk (UK) / abebooks.com (US).
 * Affiliate tracking is done through Commission Junction (CJ Affiliate), not
 * a URL tag parameter. CJ integration is a separate setup if needed later.
 *
 * ── Future path ───────────────────────────────────────────────────────────────
 * If AbeBooks affiliate commissions are required, sign up at:
 *   https://www.cj.com → find AbeBooks programme → generate tracking links
 * CJ tracking links wrap the destination URL — this file would then generate
 * the destination URL and a separate CJ wrapper would be applied.
 *
 * For now: clean search links, correct regional domain, no fake pricing.
 */

export type AbeBooksRegion = 'uk' | 'us'

/**
 * Build an AbeBooks search URL for a comic title.
 *
 * @param title  - Comic title (e.g. "Saga Vol. 1")
 * @param region - 'uk' → abebooks.co.uk, 'us' → abebooks.com
 *
 * @example
 * buildAbeBooksUrl({ title: 'Watchmen', region: 'uk' })
 * // → https://www.abebooks.co.uk/servlet/SearchResults?kn=Watchmen&tn=
 */
export function buildAbeBooksUrl(params: {
  title:  string
  region: AbeBooksRegion
}): string {
  const { title, region } = params
  const domain = region === 'uk' ? 'abebooks.co.uk' : 'abebooks.com'
  return (
    `https://www.${domain}/servlet/SearchResults` +
    `?kn=${encodeURIComponent(title.trim())}` +
    `&tn=` +
    `&cm_sp=mbc-_-abb-_-used`
  )
}
