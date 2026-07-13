#!/usr/bin/env node
/**
 * launch-smoke.mjs — public production smoke check (Wave 3B).
 *
 * Verifies the launch-critical public surface honestly: key routes respond,
 * trust copy is intact, APIs return sane shapes, and nothing fabricates data.
 * Read-only, ~11 polite requests, no auth, no paid APIs, no rate-limit bursts.
 *
 * Usage:
 *   npm run launch:smoke                      # checks https://www.catchcomics.com
 *   TARGET=http://localhost:3000 npm run launch:smoke
 *
 * Exit code 0 = pass (warnings allowed) · 1 = at least one material failure.
 * When run from the repo root, writes launch/operations/launch-smoke-latest.json
 * for Mission Control. A fetch failure is a FAILURE — never silently green.
 *
 * Plain Node (>=20, global fetch), zero dependencies — runs in CI with no
 * npm install. Keep it that way.
 */

import { writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const TARGET = (process.env.TARGET || 'https://www.catchcomics.com').replace(/\/$/, '')
const UA = 'cc-launch-smoke/1 (+launch/operations/README.md)'

// Stable fixtures — flagship records verified present in the catalogue.
const FIXTURES = {
  productSlug: 'absolute-batman-volume-2-abomination-507512',
  seriesSlug:  'saga',
  searchQuery: 'absolute batman',
  // Travelling Man listing for the product above (affiliate chain check).
  // One GET per run logs one identifiable click (User-Agent above).
  goListingId: '7a599e33-a079-46e1-9b21-a443ddebc2db',
}

const checks = []
const add = (id, label, status, detail = '') => {
  checks.push({ id, label, status, detail })
  const mark = status === 'pass' ? '✓' : status === 'warn' ? '⚠' : '✗'
  console.log(` ${mark} ${label}${detail ? ` — ${detail}` : ''}`)
}

async function get(path, opts = {}) {
  const res = await fetch(TARGET + path, {
    redirect: opts.redirect ?? 'follow',
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(20_000),
  })
  const body = opts.body === false ? '' : await res.text()
  return { res, body }
}

async function run() {
  console.log(`\nCatch Comics launch smoke — ${TARGET}\n${new Date().toISOString()}\n`)

  // ── 1. Homepage + trust copy ─────────────────────────────────────────────
  try {
    const { res, body } = await get('/')
    if (res.status !== 200) add('home', 'Homepage responds', 'fail', `HTTP ${res.status}`)
    else {
      add('home', 'Homepage responds', 'pass', 'HTTP 200')
      add('copy-eyebrow', 'Honest hero copy present', body.includes('Comic price comparison, without the tab chaos') ? 'pass' : 'fail')
      add('copy-overclaim', 'No "world\'s only" overclaim', /world['’&#x27;s]*s only/i.test(body) ? 'fail' : 'pass')
      add('copy-rail', '"Price finds today" rail present', body.includes('Price finds today') ? 'pass' : 'fail')
      add('copy-deals', 'No "Top deals" wording', body.includes('Top deals today') ? 'fail' : 'pass')
    }

    // Security headers (same response — no extra request)
    const h = res.headers
    const wanted = ['strict-transport-security', 'x-content-type-options', 'x-frame-options']
    const missing = wanted.filter(k => !h.get(k))
    const cspro = h.get('content-security-policy-report-only') || h.get('content-security-policy')
    add('headers', 'Security headers present', missing.length === 0 && cspro ? 'pass' : 'fail',
      missing.length ? `missing: ${missing.join(', ')}` : (cspro ? '' : 'missing CSP'))
  } catch (e) {
    add('home', 'Homepage responds', 'fail', String(e.message || e))
  }

  // ── 2. OG image ──────────────────────────────────────────────────────────
  try {
    const res = await fetch(TARGET + '/og-image.png', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) })
    const buf = await res.arrayBuffer()
    const ok = res.status === 200 && buf.byteLength > 10_000
    add('og', 'OG share image resolves', ok ? 'pass' : 'fail', `HTTP ${res.status}, ${buf.byteLength} bytes`)
  } catch (e) { add('og', 'OG share image resolves', 'fail', String(e.message || e)) }

  // ── 3. Search page responds sanely ──────────────────────────────────────
  // /search is a static shell + client hydration (Suspense over useSearchParams),
  // so plain HTTP can't see the hydrated start state — that is asserted in
  // Smoke Test V4 (browser). Here we prove: 200, no error page, and the shell
  // is either the hydration fallback or the start state (both acceptable).
  try {
    const { res, body } = await get('/search')
    const sane = res.status === 200 && !body.includes('Something went wrong')
      && (body.includes('Search for a comic, series or ISBN') || body.includes('Loading'))
    add('search-page', '/search responds (start state is a V4 browser check)',
      sane ? 'pass' : 'fail', `HTTP ${res.status}`)
  } catch (e) { add('search-page', '/search responds', 'fail', String(e.message || e)) }

  // ── 4. Search API shape + flagship result ────────────────────────────────
  try {
    const { res, body } = await get(`/api/search?q=${encodeURIComponent(FIXTURES.searchQuery)}&region=uk`)
    if (res.status !== 200) add('search-api', 'Search API responds', 'fail', `HTTP ${res.status}`)
    else {
      const j = JSON.parse(body)
      const results = j.canonicalResults ?? []
      const shapeOk = j.type === 'unified' && Array.isArray(results)
        && results.every(r => r.title && r.canonicalSlug && 'format' in r)
      const flagship = results.some(r => /absolute batman/i.test(r.title))
      if (!shapeOk) add('search-api', 'Search API returns valid unified shape', 'fail')
      else {
        add('search-api', 'Search API returns valid unified shape', 'pass', `${results.length} canonical results`)
        add('search-flagship', 'Flagship query finds Absolute Batman', flagship ? 'pass' : 'fail')
        if (results.length < 10) add('search-depth', 'Flagship result depth', 'warn', `only ${results.length} results`)
      }
    }
  } catch (e) { add('search-api', 'Search API responds', 'fail', String(e.message || e)) }

  // ── 5. Product page honesty ──────────────────────────────────────────────
  try {
    const { res, body } = await get(`/product/${FIXTURES.productSlug}`)
    if (res.status !== 200) add('product', 'Flagship product page loads', 'fail', `HTTP ${res.status}`)
    else {
      add('product', 'Flagship product page loads', 'pass')
      add('product-count', 'Offer count reads "tracked retailer"', body.includes('tracked retailer') ? 'pass' : 'warn',
        body.includes('tracked retailer') ? '' : 'no tracked-retailer label (may have 0 SSR offers)')
      add('product-history', 'No always-empty Price History panel', body.includes('Not enough price history') ? 'fail' : 'pass')
    }
  } catch (e) { add('product', 'Flagship product page loads', 'fail', String(e.message || e)) }

  // ── 6. Series page honesty ───────────────────────────────────────────────
  try {
    const { res, body } = await get(`/series/${FIXTURES.seriesSlug}`)
    if (res.status !== 200) add('series', 'Series page loads', 'fail', `HTTP ${res.status}`)
    else {
      add('series', 'Series page loads', 'pass')
      add('series-overclaim', 'No "every volume" price overclaim', /price comparison on every volume/i.test(body) ? 'fail' : 'pass')
      const honest = body.includes('No live price yet') || body.includes('Series information via ComicVine')
      add('series-honesty', 'Honest price/attribution states render', honest ? 'pass' : 'warn')
    }
  } catch (e) { add('series', 'Series page loads', 'fail', String(e.message || e)) }

  // ── 7. Affiliate redirect (one click, identifiable UA) ───────────────────
  try {
    const res = await fetch(`${TARGET}/go/${FIXTURES.goListingId}`, {
      redirect: 'manual', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000),
    })
    const loc = res.headers.get('location') || ''
    const ok = res.status >= 300 && res.status < 400 && /^https?:\/\//.test(loc)
    add('go', 'Affiliate redirect returns 3xx to retailer', ok ? 'pass' : 'fail', `HTTP ${res.status} → ${loc.slice(0, 60)}`)
  } catch (e) { add('go', 'Affiliate redirect returns 3xx', 'fail', String(e.message || e)) }

  // ── 8. price-hint honesty guard (no eBay call — invalid key) ────────────
  try {
    const { res, body } = await get('/api/price-hint?q=title-keys-are-refused')
    const j = res.status === 200 ? JSON.parse(body) : null
    add('price-hint', 'price-hint refuses non-ISBN keys honestly',
      j && j.lowestPrice === null && j.currency === null ? 'pass' : 'fail', `HTTP ${res.status}`)
  } catch (e) { add('price-hint', 'price-hint refuses non-ISBN keys', 'fail', String(e.message || e)) }

  // ── 9. Homepage deals API shape (no fabricated data) ────────────────────
  try {
    const { res, body } = await get('/api/homepage-deals')
    const j = res.status === 200 ? JSON.parse(body) : null
    const deals = j?.deals ?? []
    const shapeOk = Array.isArray(deals) && deals.every(d =>
      d.slug && d.title
      && (d.lowestPriceGBP === null || d.lowestPriceGBP > 0)   // never a fabricated £0
      && (!d.coverImageUrl || d.coverImageUrl.startsWith('https://images.catchcomics.com')))
    if (!shapeOk) add('deals-api', 'Homepage rail API shape honest', 'fail')
    else {
      add('deals-api', 'Homepage rail API shape honest', 'pass', `${deals.length} cards, R2 covers only`)
      if (deals.length < 8) add('deals-count', 'Rail card count', 'warn', `only ${deals.length}/12`)
    }
  } catch (e) { add('deals-api', 'Homepage rail API shape honest', 'fail', String(e.message || e)) }

  // ── 10. 404 behaviour ────────────────────────────────────────────────────
  try {
    const { res } = await get('/product/launch-smoke-does-not-exist')
    add('notfound', 'Unknown product returns 404 (not a crash)', res.status === 404 ? 'pass' : 'fail', `HTTP ${res.status}`)
  } catch (e) { add('notfound', 'Unknown product returns 404', 'fail', String(e.message || e)) }

  // ── Verdict ──────────────────────────────────────────────────────────────
  const failed = checks.filter(c => c.status === 'fail').length
  const warned = checks.filter(c => c.status === 'warn').length
  const passed = checks.filter(c => c.status === 'pass').length
  const verdict = failed > 0 ? 'FAIL' : warned > 0 ? 'PASS-WITH-WARNINGS' : 'PASS'

  console.log(`\n${verdict} — ${passed} passed · ${warned} warnings · ${failed} failed · ${TARGET}\n`)

  const out = {
    version: 1,
    environment: TARGET.includes('catchcomics.com') ? 'production' : TARGET,
    url: TARGET,
    checkedAt: new Date().toISOString(),
    verdict, passed, warned, failed,
    checks,
  }
  const dest = join(process.cwd(), 'launch', 'operations')
  if (existsSync(dest)) {
    writeFileSync(join(dest, 'launch-smoke-latest.json'), JSON.stringify(out, null, 2))
    console.log(`Recorded → launch/operations/launch-smoke-latest.json`)
  }

  process.exit(failed > 0 ? 1 : 0)
}

run().catch(e => { console.error('smoke runner crashed:', e); process.exit(1) })
