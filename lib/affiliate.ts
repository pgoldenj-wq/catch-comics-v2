/**
 * Affiliate URL wrapping.
 *
 * Given a bare retailerUrl and the retailer's affiliate network + id,
 * returns the wrapped URL that credits Catch Comics on a sale.
 *
 * Networks supported:
 *   awin  — Awin (formerly Affiliate Window). Publisher id from AWIN_PUBLISHER_ID env var.
 *   cj    — Commission Junction (CJ). Placeholder — extend when we have a CJ retailer.
 *   none  — No wrapping; return the original URL unchanged.
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
