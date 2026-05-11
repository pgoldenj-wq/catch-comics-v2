/**
 * POST /api/admin/test-connection
 *
 * Tests whether a domain's storefront API is accessible and returns a
 * human-readable result.  Supports Shopify, BigCommerce, and WooCommerce.
 * When platform is not specified, runs the full auto-detect probe sequence.
 *
 * Body:    { domain: string; platform?: string }
 * Response:{ ok: boolean; message: string; detectedPlatform?: string }
 */

import { NextRequest, NextResponse } from 'next/server'

const USER_AGENT = 'CatchComics/1.0 (+https://catchcomics.com/bot)'
const TIMEOUT_MS = 10_000

// ── Shared helpers ────────────────────────────────────────────────────────────

async function timedFetch(url: string): Promise<Response> {
  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal:  controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

function isJson(res: Response): boolean {
  return (res.headers.get('content-type') ?? '').includes('json')
}

// ── Platform-specific probes ──────────────────────────────────────────────────

async function testShopify(domain: string): Promise<NextResponse> {
  const url = `https://${domain}/products.json?limit=1`

  let res: Response
  try {
    res = await timedFetch(url)
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json({ ok: false, message: `Connection timed out after 10 s — ${domain} may be slow or unreachable.` })
    }
    return NextResponse.json({ ok: false, message: `Connection failed: ${err instanceof Error ? err.message : String(err)}` })
  }

  if (res.status === 403) {
    return NextResponse.json({
      ok: false,
      message: `403 Forbidden — ${domain} has blocked the public /products.json endpoint. This store cannot be synced via the Shopify adapter.`,
    })
  }
  if (res.status === 404) {
    return NextResponse.json({
      ok: false,
      message: `404 Not Found — ${domain} does not appear to be a Shopify store (no /products.json endpoint).`,
    })
  }
  if (!res.ok) {
    return NextResponse.json({ ok: false, message: `HTTP ${res.status} ${res.statusText} — could not reach ${domain}/products.json` })
  }

  const body     = await res.json() as { products?: Array<{ title?: string }> }
  const products = body.products ?? []
  if (products.length === 0) {
    return NextResponse.json({ ok: true, message: `✓ Connected to ${domain} — catalog appears empty (0 products on page 1). The store is accessible.` })
  }
  return NextResponse.json({
    ok     : true,
    message: `✓ Connected — ${products.length} product(s) on page 1. First: "${products[0].title ?? '(no title)'}"`,
  })
}

async function testBigCommerce(domain: string): Promise<NextResponse> {
  // Tier-1: Shopify-compat /products.json
  try {
    const t1 = await timedFetch(`https://${domain}/products.json?limit=1`)
    if (t1.ok && isJson(t1)) {
      const body = await t1.json() as { products?: Array<{ title?: string }> }
      if (Array.isArray(body.products)) {
        const sample = body.products[0]?.title ? `First: "${body.products[0].title}"` : 'catalog appears empty'
        return NextResponse.json({ ok: true, message: `✓ Connected to ${domain} via BigCommerce (Shopify-compat /products.json). ${sample}` })
      }
    }
  } catch { /* fall through to tier-2 */ }

  // Tier-2: BC Storefront API v3
  const url = `https://${domain}/api/storefront/catalog/products?limit=1&include=images,variants`
  let res: Response
  try {
    res = await timedFetch(url)
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json({ ok: false, message: `Connection timed out after 10 s — ${domain} may be slow or unreachable.` })
    }
    return NextResponse.json({ ok: false, message: `Connection failed: ${err instanceof Error ? err.message : String(err)}` })
  }

  if (!res.ok) {
    return NextResponse.json({
      ok: false,
      message: `HTTP ${res.status} on ${domain}/api/storefront/catalog/products — store may not be BigCommerce, or the endpoint is blocked.`,
    })
  }

  const body = await res.json() as unknown
  if (!Array.isArray(body)) {
    return NextResponse.json({ ok: false, message: `Unexpected response from ${domain}/api/storefront/catalog/products — may not be a BigCommerce store.` })
  }

  const arr    = body as Array<{ name?: string }>
  const sample = arr[0]?.name ? `First: "${arr[0].name}"` : 'catalog appears empty'
  return NextResponse.json({ ok: true, message: `✓ Connected to ${domain} via BigCommerce Storefront API. ${sample}` })
}

async function testWooCommerce(domain: string): Promise<NextResponse> {
  const url = `https://${domain}/wp-json/wc/store/products?per_page=1`
  let res: Response
  try {
    res = await timedFetch(url)
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json({ ok: false, message: `Connection timed out after 10 s — ${domain} may be slow or unreachable.` })
    }
    return NextResponse.json({ ok: false, message: `Connection failed: ${err instanceof Error ? err.message : String(err)}` })
  }

  if (res.status === 404) {
    return NextResponse.json({
      ok: false,
      message: `404 Not Found — ${domain} does not appear to be a WooCommerce store, or the Store API plugin is not installed.`,
    })
  }
  if (res.status === 401 || res.status === 403) {
    return NextResponse.json({ ok: false, message: `${res.status} — WooCommerce Store API on ${domain} requires authentication or is blocked.` })
  }
  if (!res.ok) {
    return NextResponse.json({ ok: false, message: `HTTP ${res.status} ${res.statusText} — could not reach ${domain}/wp-json/wc/store/products` })
  }

  const body = await res.json() as unknown
  let products: Array<{ name?: string }> = []
  if (Array.isArray(body)) {
    products = body
  } else if (body && typeof body === 'object' && Array.isArray((body as { items?: unknown }).items)) {
    products = (body as { items: Array<{ name?: string }> }).items
  } else {
    return NextResponse.json({ ok: false, message: `Unexpected response from ${domain}/wp-json/wc/store/products — may not be WooCommerce.` })
  }

  const sample = products[0]?.name ? `First: "${products[0].name}"` : 'catalog appears empty'
  return NextResponse.json({ ok: true, message: `✓ Connected to ${domain} via WooCommerce Store API. ${sample}` })
}

// ── Auto-detect (no platform specified) ──────────────────────────────────────

async function testAutoDetect(domain: string): Promise<NextResponse> {
  // Try Shopify
  try {
    const res = await timedFetch(`https://${domain}/products.json?limit=1`)
    if (res.ok && isJson(res)) {
      const body = await res.json() as { products?: Array<{ title?: string }> }
      if (Array.isArray(body.products)) {
        const sample = body.products[0]?.title ? `First: "${body.products[0].title}"` : 'catalog empty'
        return NextResponse.json({ ok: true, detectedPlatform: 'SHOPIFY', message: `✓ Detected Shopify — ${sample}` })
      }
    }
  } catch { /* continue */ }

  // Try BigCommerce Storefront API
  try {
    const res = await timedFetch(`https://${domain}/api/storefront/catalog/products?limit=1`)
    if (res.ok && isJson(res)) {
      const body = await res.json() as unknown
      if (Array.isArray(body)) {
        const arr    = body as Array<{ name?: string }>
        const sample = arr[0]?.name ? `First: "${arr[0].name}"` : 'catalog empty'
        return NextResponse.json({ ok: true, detectedPlatform: 'BIGCOMMERCE', message: `✓ Detected BigCommerce — ${sample}` })
      }
    }
  } catch { /* continue */ }

  // Try WooCommerce Store API
  try {
    const res = await timedFetch(`https://${domain}/wp-json/wc/store/products?per_page=1`)
    if (res.ok && isJson(res)) {
      const body = await res.json() as unknown
      let products: Array<{ name?: string }> | null = null
      if (Array.isArray(body)) products = body
      else if (body && typeof body === 'object' && Array.isArray((body as { items?: unknown }).items)) {
        products = (body as { items: Array<{ name?: string }> }).items
      }
      if (products) {
        const sample = products[0]?.name ? `First: "${products[0].name}"` : 'catalog empty'
        return NextResponse.json({ ok: true, detectedPlatform: 'WOOCOMMERCE', message: `✓ Detected WooCommerce — ${sample}` })
      }
    }
  } catch { /* continue */ }

  return NextResponse.json({
    ok     : false,
    message: `Could not detect a supported platform on ${domain}. Checked: Shopify (/products.json), BigCommerce (/api/storefront/catalog/products), WooCommerce (/wp-json/wc/store/products). Add the retailer manually and verify.`,
  })
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { domain, platform } = await req.json() as { domain?: string; platform?: string }

  if (!domain) {
    return NextResponse.json({ ok: false, message: 'domain is required' }, { status: 400 })
  }

  // Validate domain shape (no protocol, no path)
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain)) {
    return NextResponse.json(
      { ok: false, message: 'Invalid domain — enter a bare domain without https://' },
      { status: 400 },
    )
  }

  // Platforms without automated sync get a friendly advisory message
  if (platform && ['EBAY', 'MANUAL', 'AWIN_FEED', 'CJ_FEED', 'DIRECT_AFFILIATE'].includes(platform)) {
    return NextResponse.json({
      ok     : true,
      message: `No automated connection test for ${platform}. Add the retailer and verify manually.`,
    })
  }

  switch (platform) {
    case 'SHOPIFY':
      return testShopify(domain)
    case 'BIGCOMMERCE':
      return testBigCommerce(domain)
    case 'WOOCOMMERCE':
      return testWooCommerce(domain)
    default:
      // No platform specified — run full auto-detect
      return testAutoDetect(domain)
  }
}
