/**
 * POST /api/admin/test-connection
 *
 * Tests whether a Shopify store's /products.json endpoint is accessible.
 * Returns the first product title as a confirmation that real data is flowing.
 *
 * Body: { domain: string; platform: string }
 * Response: { ok: boolean; message: string }
 */

import { NextRequest, NextResponse } from 'next/server'

const USER_AGENT = 'CatchComics/1.0 (+https://catchcomics.com/bot)'

export async function POST(req: NextRequest) {
  const { domain, platform } = await req.json() as { domain?: string; platform?: string }

  if (!domain) {
    return NextResponse.json({ ok: false, message: 'domain is required' }, { status: 400 })
  }

  // For non-Shopify platforms we just report "no test available"
  if (platform && platform !== 'SHOPIFY') {
    return NextResponse.json({
      ok     : true,
      message: `No automated connection test for ${platform}. Add the retailer and verify manually.`,
    })
  }

  // Validate domain shape (no protocol)
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain)) {
    return NextResponse.json({ ok: false, message: 'Invalid domain — enter bare domain without https://' }, { status: 400 })
  }

  const url = `https://${domain}/products.json?limit=1`

  try {
    const controller = new AbortController()
    const timeout    = setTimeout(() => controller.abort(), 10_000)

    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal:  controller.signal,
    })

    clearTimeout(timeout)

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
      return NextResponse.json({
        ok: false,
        message: `HTTP ${res.status} ${res.statusText} — could not reach ${domain}/products.json`,
      })
    }

    const body = await res.json() as { products?: Array<{ title?: string; id?: number }> }
    const products = body.products ?? []

    if (products.length === 0) {
      return NextResponse.json({
        ok     : true,
        message: `✓ Connected to ${domain} — catalog appears empty (0 products on page 1). The store is accessible.`,
      })
    }

    const first = products[0]
    return NextResponse.json({
      ok     : true,
      message: `✓ Connected — ${products.length} product(s) on page 1. First: "${first.title ?? '(no title)'}"`,
    })

  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json({
        ok: false,
        message: `Connection timed out after 10s — ${domain} may be slow or unreachable.`,
      })
    }
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, message: `Connection failed: ${msg}` })
  }
}
