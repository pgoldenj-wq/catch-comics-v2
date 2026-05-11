/**
 * Platform auto-detection for Catch Comics retailer onboarding.
 *
 * Given a bare domain (e.g. "forbiddenplanet.com"), probes the three
 * supported storefront APIs in priority order and returns the first match.
 *
 * Probe order:
 *   1. Shopify     — GET /products.json?limit=1
 *   2. BigCommerce — GET /api/storefront/catalog/products?limit=1
 *   3. WooCommerce — GET /wp-json/wc/store/products?per_page=1
 *
 * Each probe is guarded by a 10-second AbortController timeout.
 * A probe is considered successful when:
 *   - HTTP 200
 *   - Content-Type includes "json"
 *   - Response body matches the platform's expected shape
 *
 * Returns null if no platform is detected (manual entry required).
 */

export type DetectedPlatform = 'SHOPIFY' | 'BIGCOMMERCE' | 'WOOCOMMERCE' | null

export interface AutoDetectResult {
  platform : DetectedPlatform
  /** Which endpoint responded positively (for UI confirmation messages) */
  endpoint : string | null
  /** First product title or item count, as a human-readable confirmation */
  sample   : string | null
}

const USER_AGENT = 'CatchComics/1.0 (+https://catchcomics.com/bot)'
const TIMEOUT_MS = 10_000

async function probeUrl(url: string): Promise<Response | null> {
  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers : { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal  : controller.signal,
    })
    return res
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function isJsonResponse(res: Response): boolean {
  return (res.headers.get('content-type') ?? '').includes('json')
}

// ── Shopify probe ─────────────────────────────────────────────────────────────

async function probeShopify(domain: string): Promise<AutoDetectResult | null> {
  const url = `https://${domain}/products.json?limit=1`
  const res = await probeUrl(url)
  if (!res || !res.ok || !isJsonResponse(res)) return null

  try {
    const body = await res.json() as { products?: Array<{ title?: string }> }
    if (!Array.isArray(body.products)) return null
    const sample = body.products[0]?.title
      ? `First product: "${body.products[0].title}"`
      : 'Catalog accessible (0 products on page 1)'
    return { platform: 'SHOPIFY', endpoint: url, sample }
  } catch {
    return null
  }
}

// ── BigCommerce probe ─────────────────────────────────────────────────────────

async function probeBigCommerce(domain: string): Promise<AutoDetectResult | null> {
  // Tier-1: Shopify-compat /products.json with BC data
  // (Already tried as Shopify above if it responds like Shopify, so we skip here
  //  to avoid double-counting — BC Tier-1 is identical to Shopify probe.)

  // Tier-2: BC Storefront REST API
  const url = `https://${domain}/api/storefront/catalog/products?limit=1&include=images,variants`
  const res = await probeUrl(url)
  if (!res || !res.ok || !isJsonResponse(res)) return null

  try {
    const body = await res.json() as unknown
    if (!Array.isArray(body)) return null
    const arr   = body as Array<{ name?: string }>
    const sample = arr[0]?.name
      ? `First product: "${arr[0].name}"`
      : 'Catalog accessible (0 products)'
    return { platform: 'BIGCOMMERCE', endpoint: url, sample }
  } catch {
    return null
  }
}

// ── WooCommerce probe ─────────────────────────────────────────────────────────

async function probeWooCommerce(domain: string): Promise<AutoDetectResult | null> {
  const url = `https://${domain}/wp-json/wc/store/products?per_page=1`
  const res = await probeUrl(url)
  if (!res || !res.ok || !isJsonResponse(res)) return null

  try {
    const body = await res.json() as unknown
    // Store API returns either raw array or { items, total, total_pages }
    let products: Array<{ name?: string }> = []
    if (Array.isArray(body)) {
      products = body
    } else if (body && typeof body === 'object' && Array.isArray((body as { items?: unknown }).items)) {
      products = (body as { items: Array<{ name?: string }> }).items
    } else {
      return null
    }

    const sample = products[0]?.name
      ? `First product: "${products[0].name}"`
      : 'Catalog accessible (0 products)'
    return { platform: 'WOOCOMMERCE', endpoint: url, sample }
  } catch {
    return null
  }
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Probe a domain for supported e-commerce platforms.
 *
 * Probes run sequentially so we stop on the first positive match rather than
 * firing concurrent requests at the same store.
 *
 * @param domain  Bare domain without protocol, e.g. "mystore.com"
 */
export async function detectPlatform(domain: string): Promise<AutoDetectResult> {
  const shopify = await probeShopify(domain)
  if (shopify) return shopify

  const bigcommerce = await probeBigCommerce(domain)
  if (bigcommerce) return bigcommerce

  const woocommerce = await probeWooCommerce(domain)
  if (woocommerce) return woocommerce

  return { platform: null, endpoint: null, sample: null }
}
