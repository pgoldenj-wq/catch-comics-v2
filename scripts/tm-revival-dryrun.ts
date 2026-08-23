/**
 * tm-revival-dryrun.ts — READ-ONLY complete Travelling Man catalogue
 * enumeration + classification. Produces the bounded write plan for a possible
 * later revival run. Performs no writes of any kind.
 *
 * ── Why sitemaps, not /products.json ─────────────────────────────────────────
 * The legacy /products.json pagination route CANNOT prove completeness for this
 * store: on 2026-08-23 it returned a FULL 250-product page 100 and then HTTP
 * 400 — Shopify's 25,000 (page 100 x 250) ceiling. By the existing
 * isTraversalComplete('http-400', lastPageWasFull=true) rule that is
 * truncation, so absence is never proven and no revival can be justified.
 *
 * Travelling Man publishes 38 product sitemaps holding ~1,000 URLs each
 * (~38,000 products), which is why pagination truncated. The sitemap index is
 * a closed set: fetch the index, fetch every product sitemap it lists, and
 * completeness is provable — either all of them parsed, or the run FAILS.
 *
 * ── What a sitemap does and does not give ────────────────────────────────────
 * Verified against the live files: each <url> carries <loc>, <lastmod>,
 * <changefreq> and an <image:image> block. There is NO price and NO
 * availability. Sitemaps therefore establish CATALOGUE MEMBERSHIP only.
 * Refreshing a price needs a per-product fetch; this script never issues one —
 * it reports the bounded cost so that decision can be taken deliberately.
 *
 * ── Guarantees ───────────────────────────────────────────────────────────────
 *   - ZERO writes. No prisma create/update/upsert/delete anywhere in this file.
 *   - ZERO Inngest executions. Direct CLI only.
 *   - ZERO product creations, ZERO listing inserts, ZERO identity/matching
 *     changes: rows are joined to the catalogue by the product handle already
 *     stored in retailer_listings.retailer_url. No matcher is called, no ISBN
 *     or fuzzy logic is touched.
 *   - Hard request ceilings, asserted before the first request.
 *   - Refuses to propose revivals unless the sitemap set proved complete.
 *
 * Run: npx dotenv -e .env.local -- npx tsx scripts/tm-revival-dryrun.ts
 */

import { PrismaClient }             from '@prisma/client'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join }            from 'node:path'

const prisma = new PrismaClient()

const DOMAIN            = 'travellingman.com'
const SITEMAP_INDEX     = `https://${DOMAIN}/sitemap.xml`
const USER_AGENT        = 'CatchComics/1.0 (+https://catchcomics.com/bot)'

// ── Hard bounds, asserted before any network activity ────────────────────────
/** Index + every product sitemap. 38 observed; ceiling leaves headroom. */
const MAX_SITEMAP_REQUESTS = 50
/** Per-product price/availability fetches permitted in THIS task. */
const MAX_PRODUCT_REQUESTS = 0
const BETWEEN_REQUEST_MS   = 2_000   // parity with the adapter's politeness delay
const MAX_FETCH_RETRIES    = 3       // parity with the adapter's fetchWithRetry

const OUT = join(process.cwd(), 'launch', 'operations', 'tm-revival-dryrun-latest.json')

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const log   = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`)

let requests = 0
let inboundBytes = 0

/**
 * Fetch with exponential back-off on 429/5xx, honouring Retry-After.
 * Mirrors the policy in lib/adapters/shopify.ts fetchWithRetry (not exported).
 * Counts every attempt, so the reported request total includes retries.
 */
async function fetchText(url: string): Promise<{ ok: boolean; status: number; text: string }> {
  let backoffMs = 2_000
  for (let attempt = 0; attempt <= MAX_FETCH_RETRIES; attempt++) {
    if (requests >= MAX_SITEMAP_REQUESTS) {
      throw new Error(`request ceiling ${MAX_SITEMAP_REQUESTS} reached before ${url}`)
    }
    requests++
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/xml' } })
    if (res.status === 429 || res.status >= 500) {
      if (attempt === MAX_FETCH_RETRIES) return { ok: false, status: res.status, text: '' }
      const retryAfter = Number(res.headers.get('retry-after'))
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : backoffMs
      log(`  HTTP ${res.status} on ${url} — backing off ${waitMs}ms (attempt ${attempt + 1})`)
      await sleep(waitMs)
      backoffMs *= 2
      continue
    }
    const text = await res.text()
    inboundBytes += Buffer.byteLength(text)
    return { ok: res.ok, status: res.status, text }
  }
  return { ok: false, status: 0, text: '' }
}

/** All <loc> values in a sitemap or sitemap index, XML-entity decoded. */
function extractLocs(xml: string): string[] {
  const out: string[] = []
  const re = /<loc>([\s\S]*?)<\/loc>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    out.push(
      m[1].trim()
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
    )
  }
  return out
}

/**
 * Product handle from any travellingman.com product URL.
 * Applied identically to sitemap <loc> values and to the retailer_url already
 * stored on each listing, so the join uses existing stored identity only.
 */
function handleOf(url: string): string | null {
  const m = /\/products\/([^/?#]+)/.exec(url)
  return m ? decodeURIComponent(m[1]).toLowerCase() : null
}

async function main() {
  const t0 = Date.now()

  log(`BOUNDS  sitemap requests <= ${MAX_SITEMAP_REQUESTS} · per-product requests = ${MAX_PRODUCT_REQUESTS} · writes = 0 · inngest = 0`)

  const retailer = await prisma.retailer.findFirst({ where: { domain: DOMAIN } })
  if (!retailer) { console.error('Travelling Man not found'); process.exit(1) }

  const cfg = (retailer.syncConfig ?? {}) as Record<string, unknown>
  log(`retailer=${retailer.name} domain=${retailer.domain} platform=${retailer.platform} active=${retailer.isActive}`)
  log(`scheduled_sync_disabled = ${JSON.stringify(cfg.scheduled_sync_disabled ?? null)}  (unset => the hourly cron WILL enqueue TM if un-paused)`)
  log(`comic_filter            = ${JSON.stringify(cfg.comic_filter ?? null)}`)
  log(`lastSyncedAt            = ${retailer.lastSyncedAt?.toISOString() ?? 'never'}`)

  // ── DB side: every stored TM listing, minimal columns (never raw_data) ─────
  const rows = await prisma.retailerListing.findMany({
    where:  { retailerId: retailer.id },
    select: { id: true, retailerUrl: true, deletedAt: true, priceAmount: true, canonicalProductId: true },
  })
  const storedActive  = rows.filter(r => !r.deletedAt).length
  const storedDeleted = rows.length - storedActive
  const rowsWithoutHandle = rows.filter(r => handleOf(r.retailerUrl) === null).length
  log(`stored TM listings: ${rows.length.toLocaleString()} (active ${storedActive.toLocaleString()}, soft-deleted ${storedDeleted.toLocaleString()}, unparseable url ${rowsWithoutHandle})`)

  // ── 1. Sitemap index ──────────────────────────────────────────────────────
  log(`fetching sitemap index ${SITEMAP_INDEX}`)
  const idx = await fetchText(SITEMAP_INDEX)
  if (!idx.ok) {
    log(`ABORT — sitemap index returned HTTP ${idx.status}. Completeness cannot be proven.`)
    await finish({ complete: false, abortReason: `sitemap index HTTP ${idx.status}` })
    return
  }
  const productSitemaps = extractLocs(idx.text).filter(u => /sitemap_products_\d+\.xml/.test(u))
  log(`sitemap index lists ${productSitemaps.length} product sitemap file(s)`)

  if (productSitemaps.length === 0) {
    log('ABORT — index lists no product sitemaps.')
    await finish({ complete: false, abortReason: 'no product sitemaps listed in index' })
    return
  }
  // Bound check BEFORE fetching: index (already spent) + every product sitemap.
  if (productSitemaps.length + 1 > MAX_SITEMAP_REQUESTS) {
    log(`ABORT — ${productSitemaps.length + 1} requests needed exceeds ceiling ${MAX_SITEMAP_REQUESTS}. Raise the ceiling deliberately or narrow the task.`)
    await finish({ complete: false, abortReason: `needed ${productSitemaps.length + 1} > ceiling ${MAX_SITEMAP_REQUESTS}` })
    return
  }

  // ── 2. Every product sitemap. All must succeed, or completeness FAILS ──────
  const catalogueHandles = new Set<string>()
  let filesFetched = 0, urlsSeen = 0, productUrls = 0
  const failedFiles: { url: string; status: number }[] = []

  for (const [i, sm] of productSitemaps.entries()) {
    await sleep(BETWEEN_REQUEST_MS)
    const res = await fetchText(sm)
    if (!res.ok) {
      failedFiles.push({ url: sm, status: res.status })
      log(`  file ${i + 1}/${productSitemaps.length} FAILED HTTP ${res.status}`)
      continue
    }
    filesFetched++
    const locs = extractLocs(res.text)
    urlsSeen += locs.length
    for (const loc of locs) {
      const h = handleOf(loc)
      if (h) { catalogueHandles.add(h); productUrls++ }
    }
    if ((i + 1) % 10 === 0 || i === 0 || i === productSitemaps.length - 1) {
      log(`  file ${i + 1}/${productSitemaps.length}: ${locs.length} urls (running distinct handles ${catalogueHandles.size.toLocaleString()})`)
    }
  }

  // Completeness rule for this source: the index was readable, it listed at
  // least one product sitemap, EVERY listed file parsed, and the result is
  // non-empty. A single missing file means the catalogue set is unproven and
  // nothing may be revived.
  const complete = failedFiles.length === 0 && filesFetched === productSitemaps.length && catalogueHandles.size > 0
  const abortReason = complete ? null : `${failedFiles.length} of ${productSitemaps.length} product sitemap(s) failed`

  await finish({
    complete, abortReason,
    productSitemaps: productSitemaps.length, filesFetched, urlsSeen, productUrls,
    catalogueHandles, failedFiles,
  })

  // ── Reporting + classification ────────────────────────────────────────────
  async function finish(t: {
    complete: boolean
    abortReason: string | null
    productSitemaps?: number
    filesFetched?: number
    urlsSeen?: number
    productUrls?: number
    catalogueHandles?: Set<string>
    failedFiles?: { url: string; status: number }[]
  }) {
    const handles = t.catalogueHandles ?? new Set<string>()

    const reSeen         = rows.filter(r => { const h = handleOf(r.retailerUrl); return h !== null && handles.has(h) })
    const reSeenIds      = new Set(reSeen.map(r => r.id))
    const activeReSeen   = reSeen.filter(r => !r.deletedAt)
    const deletedReSeen  = reSeen.filter(r =>  r.deletedAt)
    const deletedNotSeen = rows.filter(r =>  r.deletedAt && !reSeenIds.has(r.id))
    const activeNotSeen  = rows.filter(r => !r.deletedAt && !reSeenIds.has(r.id))

    // Catalogue handles with no stored row — would be INSERTS under allowCreate.
    // Reported for visibility only; the proposal is and stays 0.
    const storedHandles = new Set(rows.map(r => handleOf(r.retailerUrl)).filter(Boolean) as string[])
    let catalogueHandlesWithNoRow = 0
    for (const h of handles) if (!storedHandles.has(h)) catalogueHandlesWithNoRow++

    // ComicVine evidence within the revival candidate set (aggregate only)
    let cv = 0, unmatched = 0, priced = 0
    if (deletedReSeen.length > 0) {
      const [agg] = await prisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*) FILTER (WHERE c.comicvine_id IS NOT NULL OR c.cv_metadata IS NOT NULL) AS cv,
                COUNT(*) FILTER (WHERE l.canonical_product_id IS NULL)                          AS unmatched,
                COUNT(*) FILTER (WHERE l.price_amount > 0)                                      AS priced
         FROM retailer_listings l LEFT JOIN canonical_products c ON c.id = l.canonical_product_id
         WHERE l.id = ANY($1::uuid[])`, deletedReSeen.map(r => r.id))
      cv = Number(agg.cv); unmatched = Number(agg.unmatched); priced = Number(agg.priced)
    }

    // Sitemaps carry no price/availability. Cost of the follow-up, NOT run here.
    const rowsNeedingPriceFetch = t.complete ? activeReSeen.length + deletedReSeen.length : 0
    const followUp = {
      requestsRequired: rowsNeedingPriceFetch,
      estimatedMinutesAt1Rps: Math.round(rowsNeedingPriceFetch / 60),
      estimatedMinutesAt2sPacing: Math.round((rowsNeedingPriceFetch * 2) / 60),
      approxInboundMiB: Number(((rowsNeedingPriceFetch * 3_000) / 1_048_576).toFixed(1)),
      requestsIssuedThisRun: MAX_PRODUCT_REQUESTS,
      note: 'Shopify sitemaps contain loc/lastmod/changefreq/image only — no price, no availability. '
          + 'A price refresh needs one /products/<handle>.js per row. NOT performed in this task.',
    }

    const wallMs = Date.now() - t0
    const report = {
      version: 2, runAt: new Date().toISOString(), mode: 'DRY-RUN (read-only)',
      enumerationSource: 'sitemap index + product sitemaps',
      retailer: {
        name: retailer!.name, domain: retailer!.domain, platform: retailer!.platform,
        scheduledSyncDisabled: cfg.scheduled_sync_disabled ?? null,
        comicFilter: cfg.comic_filter ?? null,
        lastSyncedAt: retailer!.lastSyncedAt?.toISOString() ?? null,
      },
      traversal: {
        complete: t.complete, abortReason: t.abortReason,
        sitemapFilesDiscovered: t.productSitemaps ?? 0,
        sitemapFilesFetched:    t.filesFetched ?? 0,
        failedFiles:            t.failedFiles ?? [],
        urlsSeen:               t.urlsSeen ?? 0,
        productUrls:            t.productUrls ?? 0,
        distinctCatalogueHandles: handles.size,
        requests, inboundBytes,
        maxSitemapRequests: MAX_SITEMAP_REQUESTS,
        maxProductRequests: MAX_PRODUCT_REQUESTS,
        wallClockMs: wallMs,
      },
      counts: {
        storedListings: rows.length, storedActive, storedSoftDeleted: storedDeleted,
        storedRowsWithUnparseableUrl: rowsWithoutHandle,
        reSeen: reSeen.length,
        activeReSeen_wouldRefresh: activeReSeen.length,
        activeNotSeen: activeNotSeen.length,
        softDeletedReSeen_revivalCandidates: deletedReSeen.length,
        softDeletedNotSeen_remainDeleted: deletedNotSeen.length,
        revivalCandidates_comicvineIdentified: cv,
        revivalCandidates_unmatched: unmatched,
        revivalCandidates_priced: priced,
        catalogueHandlesWithNoStoredRow: catalogueHandlesWithNoRow,
        proposedInserts: 0,
        proposedCanonicalCreations: 0,
        proposedIdentityChanges: 0,
        proposedRevivals: t.complete ? deletedReSeen.length : 0,
        totalRowsASubsequentWriteWouldModify: t.complete ? activeReSeen.length + deletedReSeen.length : 0,
      },
      priceRefreshFollowUp: followUp,
      writesPerformed: 0,
      inngestExecutions: 0,
    }

    mkdirSync(dirname(OUT), { recursive: true })
    writeFileSync(OUT, JSON.stringify(report, null, 2))

    log('')
    log(`TRAVERSAL COMPLETENESS : ${t.complete ? 'PASS' : 'FAIL'}${t.abortReason ? ` (${t.abortReason})` : ''}`)
    log(`sitemap files discovered/fetched : ${t.productSitemaps ?? 0} / ${t.filesFetched ?? 0}`)
    log(`catalogue urls / distinct handles: ${(t.productUrls ?? 0).toLocaleString()} / ${handles.size.toLocaleString()}`)
    log(`http requests / inbound          : ${requests} / ${(inboundBytes / 1048576).toFixed(1)} MiB`)
    log('')
    log(`existing rows re-seen            : ${reSeen.length.toLocaleString()}`)
    log(`  active -> would refresh        : ${activeReSeen.length.toLocaleString()}`)
    log(`  soft-deleted -> revival cand.  : ${deletedReSeen.length.toLocaleString()}`)
    log(`    ComicVine-identified         : ${cv.toLocaleString()}`)
    log(`    unmatched                    : ${unmatched.toLocaleString()}`)
    log(`soft-deleted NOT re-seen         : ${deletedNotSeen.length.toLocaleString()} (stay deleted)`)
    log(`active NOT re-seen               : ${activeNotSeen.length.toLocaleString()}`)
    log(`catalogue handles with no row    : ${catalogueHandlesWithNoRow.toLocaleString()} -> proposed inserts 0`)
    log('')
    log(`PROPOSED revivals                : ${report.counts.proposedRevivals.toLocaleString()}`)
    log(`PROPOSED inserts / creations / identity changes : 0 / 0 / 0`)
    log(`rows a subsequent --write modifies: ${report.counts.totalRowsASubsequentWriteWouldModify.toLocaleString()}`)
    log('')
    log(`price/availability follow-up     : ${followUp.requestsRequired.toLocaleString()} requests needed, `
      + `~${followUp.estimatedMinutesAt1Rps} min @1/s (~${followUp.estimatedMinutesAt2sPacing} min @2s), `
      + `~${followUp.approxInboundMiB} MiB — ISSUED THIS RUN: ${MAX_PRODUCT_REQUESTS}`)
    log(`writes performed                 : 0`)
    log(`wall clock                       : ${(wallMs / 1000).toFixed(1)}s`)
    log(`-> ${OUT}`)

    await prisma.$disconnect()
  }
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
