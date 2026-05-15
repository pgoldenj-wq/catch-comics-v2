/**
 * Affiliate URL wrapping.
 *
 * Given a bare retailerUrl and the retailer's affiliate network + id,
 * returns the wrapped URL that credits Catch Comics on a sale.
 *
 * Networks supported:
 *   awin      — Awin (formerly Affiliate Window). Publisher id from AWIN_PUBLISHER_ID env var.
 *   bookshop  — Bookshop.org affiliate programme. affiliateId = their partner ID.
 *               Deep-link format: https://bookshop.org/a/{affiliateId}/{path}
 *   cj        — Commission Junction (CJ). Placeholder — extend when we have a CJ retailer.
 *   none      — No wrapping; return the original URL unchanged.
 *
 * If AWIN_PUBLISHER_ID is not set, Awin URLs are returned unwrapped (safe fallback).
 */

/** Networks the wrapping logic understands. */
export type AffiliateNetwork = 'awin' | 'cj' | string | null | undefined

/**
 * Wrap `targetUrl` through the given affiliate network.
 * Returns the original URL if the network is unrecognised or misconfigured.
 */
export function wrapAffiliateUrl(
  targetUrl:        string,
  affiliateNetwork: AffiliateNetwork,
  affiliateId:      string | null | undefined,
): string {
  if (!affiliateNetwork || !affiliateId) return targetUrl

  switch (affiliateNetwork.toLowerCase()) {
    case 'awin': {
      const publisherId = process.env.AWIN_PUBLISHER_ID
      if (!publisherId) {
        console.warn('[affiliate] AWIN_PUBLISHER_ID not set — returning unwrapped URL')
        return targetUrl
      }
      // Awin deep-link format:
      // https://www.awin1.com/cread.php?awinmid={merchantId}&awinaffid={publisherId}&ued={encodedTargetUrl}
      const params = new URLSearchParams({
        awinmid:   affiliateId,
        awinaffid: publisherId,
        ued:       targetUrl,
      })
      return `https://www.awin1.com/cread.php?${params.toString()}`
    }

    case 'bookshop': {
      // Bookshop.org affiliate deep-link format:
      // https://bookshop.org/a/{affiliateId}/{productPath}
      // targetUrl is e.g. https://uk.bookshop.org/p/books/saga-vol-1/123456
      // Strip the origin and prepend the affiliate base.
      try {
        const url    = new URL(targetUrl)
        const path   = url.pathname + url.search + url.hash
        const origin = url.hostname.includes('uk.') ? 'https://uk.bookshop.org' : 'https://bookshop.org'
        return `${origin}/a/${affiliateId}${path}`
      } catch {
        console.warn('[affiliate] bookshop URL parse failed — returning unwrapped URL', targetUrl)
        return targetUrl
      }
    }

    case 'cj': {
      // Commission Junction — extend when we have a live CJ retailer.
      // Format: https://www.anrdoezrs.net/click-{publisherId}-{merchantId}?url={encodedTargetUrl}
      // For now, return unwrapped.
      console.warn('[affiliate] CJ wrapping not yet implemented — returning unwrapped URL')
      return targetUrl
    }

    default:
      return targetUrl
  }
}
