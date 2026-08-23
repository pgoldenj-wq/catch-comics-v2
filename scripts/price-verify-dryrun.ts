/**
 * price-verify-dryrun.ts — live price/availability verification for two
 * bounded, already-established cohorts.
 *
 * DEFAULT MODE IS READ-ONLY. Writes happen only with an explicit --write flag.
 *
 * --write refreshes ONLY rows that verified live in the SAME run, and only
 * through the existing upsert semantics for an existing listing (see
 * lib/adapters/shopify.ts upsertListing): priceAmount, stockStatus, lastSeenAt,
 * plus lastPriceChangeAt and ONE price_history row when — and only when — the
 * price genuinely changed. Every update is scoped `deletedAt: null`, so a
 * soft-deleted row is unreachable by construction. No listing is created, no
 * canonical product is created, no matcher runs, and retailer.lastSyncedAt is
 * deliberately NOT touched: that field means a COMPLETE retailer sync, and this
 * is a bounded refresh of existing rows.
 *
 *   Cohort A — Travelling Man: currently ACTIVE listings whose product handle
 *              was present in the completed 38-file sitemap enumeration.
 *              /products.json pagination is NOT used: it truncates at 25,000
 *              against a 37,782-product catalogue and cannot prove membership.
 *   Cohort B — World of Books: the existing comic-linked cohort under the
 *              CURRENT trust criteria (ComicVine id, CV metadata, or a comic
 *              publisher on the canonical product). Criteria are NOT broadened.
 *
 * Identity rules are the EXISTING ones, unchanged:
 *   - retailer_sku "<productId>-<variantId>" → that exact variant must exist.
 *     No substitution. Absent ⇒ classified `variantMissing`.
 *   - retailer_sku "<productId>" → the product-level listing, resolved by the
 *     adapter's existing primary rule (first available variant, else the
 *     first). Empty variants ⇒ `variantMissing`.
 *   - The live product id must equal the stored product id, or the row is
 *     `productIdMismatch`. Handles are never trusted as identity on their own.
 *   - No fuzzy title matching, no ISBN re-derivation, no new matches.
 *
 * A failed request is NEVER fresh and NEVER out-of-stock: transient/throttle
 * failures get their own bucket and are excluded from the writable set.
 *
 * Guarantees in BOTH modes: 0 Inngest executions · 0 canonical creations ·
 * 0 listing creations · 0 matcher calls · no deleted_at ever cleared · the
 * 23,315 soft-deleted TM rows are never touched. In default mode, additionally
 * 0 writes of any kind.
 *
 * Run (read-only):
 *   npx dotenv -e .env.local -- npx tsx scripts/price-verify-dryrun.ts
 * Run (bounded write):
 *   npx dotenv -e .env.local -- npx tsx scripts/price-verify-dryrun.ts --write --max-rows 2300
 */

import { PrismaClient, Prisma }     from '@prisma/client'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join }            from 'node:path'

const prisma = new PrismaClient()

// ── Mode ─────────────────────────────────────────────────────────────────────
const argv     = process.argv.slice(2)
const WRITE    = argv.includes('--write')          // default: read-only
const rowsIdx  = argv.indexOf('--max-rows')
const MAX_ROWS_ARG = rowsIdx !== -1 ? parseInt(argv[rowsIdx + 1] ?? '', 10) : NaN

/**
 * Price-plausibility guard. A verified read is still refused if the live value
 * is nonsensical or moves by more than 10x in either direction — a bounded
 * refresh must never launder a scraping artefact into a customer-facing price.
 * Refused rows are written NOTHING at all, not even freshness.
 */
const MAX_PRICE_RATIO = 10

const TM_DOMAIN  = 'travellingman.com'
const WOB_DOMAIN = 'worldofbooks.com'
const USER_AGENT = 'CatchComics/1.0 (+https://catchcomics.com/bot)'

// ── Hard ceilings, asserted before the first product request ─────────────────
const TM_MAX_ROWS            = 2_300
const WOB_MAX_ROWS           = 50
const TOTAL_TARGET_ROWS      = 2_350
const TOTAL_PRODUCT_REQUESTS = 2_350   // base requests, excludes bounded retries
const TOTAL_REQUESTS_MAX     = 2_600   // including retries and sitemaps
const MAX_SITEMAP_REQUESTS   = 50      // index + 38 product sitemaps

// ── Conservative pacing / backoff ────────────────────────────────────────────
const BETWEEN_PRODUCT_MS = 1_000  // strictly sequential, 1 req/s, no concurrency
const BETWEEN_SITEMAP_MS = 2_000
const MAX_RETRIES        = 3      // mirrors the adapter's fetchWithRetry policy
const BACKOFF_BASE_MS    = 2_000

// ── Circuit breaker: stop if the retailer will not tolerate this rate ────────
const MAX_CONSECUTIVE_TRANSIENT = 8
const TRANSIENT_RATE_LIMIT      = 0.05   // 5%
const TRANSIENT_RATE_MIN_SAMPLE = 200

const OUT = join(process.cwd(), 'launch', 'operations',
  WRITE ? 'price-verify-write-latest.json' : 'price-verify-dryrun-latest.json')

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const log   = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`)

let sitemapRequests = 0
let productRequests = 0   // first attempts only
let retryRequests   = 0
let inboundBytes    = 0

type Klass =
  | 'availableUnchanged' | 'availablePriceChanged' | 'unavailable'
  | 'variantMissing' | 'productIdMismatch' | 'notFound'
  | 'transient' | 'otherError'

interface RowResult {
  id: string; sku: string; klass: Klass; stored: string; live: string | null
  /** Populated only in --write mode. */
  written?: boolean
  writeSkipReason?: string
}

interface PriceChange {
  retailer: string; listingId: string; sku: string
  oldPrice: number; newPrice: number; absDiff: number; pctDiff: number
  written: boolean; excludedReason?: string
}

const priceChanges: PriceChange[] = []
let rowsWritten = 0, priceHistoryRows = 0, writeSkippedNotActive = 0, excludedImplausible = 0

function handleOf(url: string): string | null {
  const m = /\/products\/([^/?#]+)/.exec(url)
  return m ? decodeURIComponent(m[1]).toLowerCase() : null
}

function extractLocs(xml: string): string[] {
  const out: string[] = []
  const re = /<loc>([\s\S]*?)<\/loc>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
  }
  return out
}

async function fetchRaw(url: string, accept: string): Promise<{ status: number; text: string; transient: boolean }> {
  let backoff = BACKOFF_BASE_MS
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept } })
    if (res.status === 429 || res.status >= 500) {
      if (attempt === MAX_RETRIES) return { status: res.status, text: '', transient: true }
      const ra = Number(res.headers.get('retry-after'))
      const waitMs = Number.isFinite(ra) && ra > 0 ? ra * 1_000 : backoff
      retryRequests++
      await sleep(waitMs)
      backoff *= 2
      continue
    }
    const text = await res.text()
    inboundBytes += Buffer.byteLength(text)
    return { status: res.status, text, transient: false }
  }
  return { status: 0, text: '', transient: true }
}

/** Verify one stored row against the live product endpoint. */
async function verifyRow(
  domain: string,
  row: { id: string; retailerSku: string; retailerUrl: string; priceAmount: unknown },
): Promise<RowResult> {
  const handle = handleOf(row.retailerUrl)
  const stored = String(row.priceAmount)
  const base: Omit<RowResult, 'klass' | 'live'> = { id: row.id, sku: row.retailerSku, stored }
  if (!handle) return { ...base, klass: 'otherError', live: null }

  productRequests++
  const res = await fetchRaw(`https://${domain}/products/${handle}.js`, 'application/json')

  if (res.transient)        return { ...base, klass: 'transient',  live: null }
  if (res.status === 404)   return { ...base, klass: 'notFound',   live: null }
  if (res.status !== 200)   return { ...base, klass: 'otherError', live: null }

  let p: { id: number | string; variants?: { id: number | string; price: string; available: boolean; barcode?: string | null }[] }
  try { p = JSON.parse(res.text) } catch { return { ...base, klass: 'otherError', live: null } }

  const storedPid = row.retailerSku.includes('-') ? row.retailerSku.split('-')[0] : row.retailerSku
  if (String(p.id) !== storedPid) return { ...base, klass: 'productIdMismatch', live: null }

  const variants = p.variants ?? []
  if (variants.length === 0) return { ...base, klass: 'variantMissing', live: null }

  let variant: typeof variants[number] | undefined
  if (row.retailerSku.includes('-')) {
    // Exact stored variant only — never substitute another.
    const vid = row.retailerSku.split('-')[1]
    variant = variants.find(v => String(v.id) === vid)
  } else {
    // Product-level row: the adapter's existing primary rule.
    variant = variants.find(v => v.available) ?? variants[0]
  }
  if (!variant) return { ...base, klass: 'variantMissing', live: null }

  const livePrice = Number(variant.price) / 100
  const live = livePrice.toFixed(2)
  if (!variant.available) return { ...base, klass: 'unavailable', live }
  return {
    ...base,
    klass: Number(live) === Number(stored) ? 'availableUnchanged' : 'availablePriceChanged',
    live,
  }
}

/**
 * Write ONE row that verified live in this same run. Mirrors the existing
 * upsertListing semantics for an existing listing. Never reachable for a
 * soft-deleted row: the update is scoped `deletedAt: null` in SQL, so even a
 * logic error upstream cannot touch one.
 */
async function writeRow(retailerName: string, r: RowResult): Promise<void> {
  // Belt-and-braces: this function must be unreachable without --write.
  if (!WRITE) throw new Error('writeRow reached in read-only mode — aborting rather than writing')
  const eligible = r.klass === 'availableUnchanged' || r.klass === 'availablePriceChanged' || r.klass === 'unavailable'
  if (!eligible) { r.written = false; r.writeSkipReason = `unverified (${r.klass})`; return }
  if (r.live === null) { r.written = false; r.writeSkipReason = 'no live price'; return }

  const oldPrice = Number(r.stored)
  const newPrice = Number(r.live)
  const priceChanged = newPrice !== oldPrice

  if (priceChanged) {
    const implausible =
      !Number.isFinite(newPrice) || newPrice <= 0 ||
      (oldPrice > 0 && (newPrice / oldPrice > MAX_PRICE_RATIO || oldPrice / newPrice > MAX_PRICE_RATIO))
    const change: PriceChange = {
      retailer: retailerName, listingId: r.id, sku: r.sku,
      oldPrice, newPrice,
      absDiff: Number((newPrice - oldPrice).toFixed(2)),
      pctDiff: oldPrice > 0 ? Number((((newPrice - oldPrice) / oldPrice) * 100).toFixed(2)) : 0,
      written: false,
    }
    if (implausible) {
      change.excludedReason = `price ratio beyond ${MAX_PRICE_RATIO}x or non-positive`
      priceChanges.push(change)
      excludedImplausible++
      r.written = false; r.writeSkipReason = 'implausible price — excluded by guard'
      return
    }
    priceChanges.push(change)
  }

  const now = new Date()
  const res = await prisma.retailerListing.updateMany({
    // deletedAt: null is the hard guard — a soft-deleted row cannot be updated.
    where: { id: r.id, deletedAt: null },
    data: {
      priceAmount: new Prisma.Decimal(r.live),
      stockStatus: r.klass === 'unavailable' ? 'OUT_OF_STOCK' : 'IN_STOCK',
      lastSeenAt:  now,
      ...(priceChanged ? { lastPriceChangeAt: now } : {}),
    },
  })

  if (res.count !== 1) {
    writeSkippedNotActive++
    r.written = false
    r.writeSkipReason = `updateMany matched ${res.count} active row(s)`
    if (priceChanged) priceChanges[priceChanges.length - 1].excludedReason = 'row not active at write time'
    return
  }

  rowsWritten++
  r.written = true

  // Genuine observation only: the existing architecture appends price_history
  // on a real price change, and never otherwise.
  if (priceChanged) {
    await prisma.priceHistory.create({
      data: {
        retailerListingId: r.id,
        priceAmount:       new Prisma.Decimal(r.live),
        priceCurrency:     'GBP',
        stockStatus:       r.klass === 'unavailable' ? 'OUT_OF_STOCK' : 'IN_STOCK',
        recordedAt:        now,
      },
    })
    priceHistoryRows++
    priceChanges[priceChanges.length - 1].written = true
  }
}

async function main() {
  const t0 = Date.now()
  const tally = (rs: RowResult[], k: Klass) => rs.filter(r => r.klass === k).length

  log('── INTENDED WORK (printed before any product request) ──────────────────')
  log(`MODE: ${WRITE ? 'WRITE (bounded, verified-in-run rows only)' : 'DRY-RUN (read-only, default)'}`)
  log(`ceilings: TM rows <= ${TM_MAX_ROWS} · WoB rows <= ${WOB_MAX_ROWS} · total target rows <= ${TOTAL_TARGET_ROWS}`)
  log(`          base product requests <= ${TOTAL_PRODUCT_REQUESTS} · total requests incl. retries <= ${TOTAL_REQUESTS_MAX}`)
  if (Number.isFinite(MAX_ROWS_ARG)) log(`--max-rows ${MAX_ROWS_ARG} supplied`)
  log(`pacing: ${BETWEEN_PRODUCT_MS}ms sequential, no concurrency · retries <= ${MAX_RETRIES} with ${BACKOFF_BASE_MS}ms doubling backoff`)
  log(`breaker: stop after ${MAX_CONSECUTIVE_TRANSIENT} consecutive transient failures, or >${TRANSIENT_RATE_LIMIT * 100}% transient over ${TRANSIENT_RATE_MIN_SAMPLE}+ requests`)
  log(`guards: price ratio <= ${MAX_PRICE_RATIO}x · updates scoped deletedAt:null · 0 creates · 0 matcher · 0 inngest · lastSyncedAt untouched`)

  // Production state BEFORE, for the reconciliation proof.
  const snapshot = async () => {
    const out: Record<string, any> = {}
    for (const d of [TM_DOMAIN, WOB_DOMAIN]) {
      const r = await prisma.retailer.findFirst({ where: { domain: d } })
      const [a] = await prisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE deleted_at IS NULL) AS active,
                COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted,
                COUNT(*) FILTER (WHERE deleted_at IS NULL AND stock_status='IN_STOCK') AS in_stock,
                COUNT(*) FILTER (WHERE deleted_at IS NULL AND stock_status='OUT_OF_STOCK') AS oos,
                MAX(last_seen_at) AS max_last_seen
         FROM retailer_listings WHERE retailer_id=$1::uuid`, r!.id)
      const [l] = await prisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*) AS n, MAX(started_at) AS latest FROM sync_logs WHERE retailer_id=$1::uuid`, r!.id)
      out[d] = {
        total: Number(a.total), active: Number(a.active), deleted: Number(a.deleted),
        inStock: Number(a.in_stock), outOfStock: Number(a.oos),
        maxLastSeenAt: a.max_last_seen?.toISOString() ?? null,
        lastSyncedAt: r!.lastSyncedAt?.toISOString() ?? null,
        syncLogs: Number(l.n), syncLogsLatest: l.latest?.toISOString() ?? null,
        scheduledSyncDisabled: (r!.syncConfig as any)?.scheduled_sync_disabled ?? null,
      }
    }
    const [c] = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*) AS n FROM canonical_products`)
    const [t] = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*) AS n FROM retailer_listings`)
    const [p] = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*) AS n FROM price_history`)
    out.canonicalProducts = Number(c.n); out.retailerListings = Number(t.n); out.priceHistory = Number(p.n)
    return out
  }
  const before = await snapshot()
  log(`BEFORE  TM active ${before[TM_DOMAIN].active} (in-stock ${before[TM_DOMAIN].inStock}/oos ${before[TM_DOMAIN].outOfStock}) deleted ${before[TM_DOMAIN].deleted} · WoB active ${before[WOB_DOMAIN].active} · canonical ${before.canonicalProducts} · listings ${before.retailerListings} · price_history ${before.priceHistory}`)

  const tm  = await prisma.retailer.findFirst({ where: { domain: TM_DOMAIN } })
  const wob = await prisma.retailer.findFirst({ where: { domain: WOB_DOMAIN } })
  if (!tm || !wob) { console.error('retailer(s) not found'); process.exit(1) }

  const tmCfg = (tm.syncConfig ?? {}) as Record<string, unknown>
  log(`TM scheduled_sync_disabled = ${JSON.stringify(tmCfg.scheduled_sync_disabled ?? null)}`)

  // ── Cohort A: complete sitemap enumeration, then ACTIVE ∩ sitemap ─────────
  log('enumerating TM catalogue from sitemaps (membership source of record)…')
  sitemapRequests++
  const idx = await fetchRaw(`https://${TM_DOMAIN}/sitemap.xml`, 'application/xml')
  if (idx.status !== 200) { log(`ABORT — sitemap index HTTP ${idx.status}`); await prisma.$disconnect(); process.exit(1) }
  const files = extractLocs(idx.text).filter(u => /sitemap_products_\d+\.xml/.test(u))
  if (files.length + 1 > MAX_SITEMAP_REQUESTS) { log('ABORT — sitemap ceiling'); await prisma.$disconnect(); process.exit(1) }

  const handles = new Set<string>()
  let filesFetched = 0
  for (const f of files) {
    await sleep(BETWEEN_SITEMAP_MS)
    sitemapRequests++
    const r = await fetchRaw(f, 'application/xml')
    if (r.status !== 200) { log(`ABORT — sitemap file HTTP ${r.status}; membership unproven`); await prisma.$disconnect(); process.exit(1) }
    filesFetched++
    for (const loc of extractLocs(r.text)) { const h = handleOf(loc); if (h) handles.add(h) }
  }
  log(`sitemaps ${filesFetched}/${files.length} · distinct handles ${handles.size.toLocaleString()} · COMPLETE=${filesFetched === files.length}`)
  if (filesFetched !== files.length) { log('ABORT — enumeration incomplete'); await prisma.$disconnect(); process.exit(1) }

  const tmActive = await prisma.retailerListing.findMany({
    where:  { retailerId: tm.id, deletedAt: null },
    select: { id: true, retailerSku: true, retailerUrl: true, priceAmount: true },
  })
  const tmTargets = tmActive.filter(r => { const h = handleOf(r.retailerUrl); return h !== null && handles.has(h) })
  const tmExcluded = tmActive.length - tmTargets.length

  // ── Cohort B: WoB comic-linked cohort, CURRENT criteria verbatim ──────────
  const wobTargets = await prisma.$queryRawUnsafe<any[]>(
    `SELECT l.id::text AS id, l.retailer_sku AS "retailerSku", l.retailer_url AS "retailerUrl", l.price_amount AS "priceAmount"
     FROM retailer_listings l
     JOIN canonical_products c ON c.id = l.canonical_product_id
     WHERE l.retailer_id = $1::uuid AND l.deleted_at IS NULL AND l.price_amount > 0
       AND (c.comicvine_id IS NOT NULL OR c.cv_metadata IS NOT NULL
            OR c.publisher ILIKE ANY(ARRAY['%marvel%','%dc comic%','%image comic%','%dark horse%','%idw%','%viz%','%kodansha%','%boom%','%titan%','%rebellion%','%yen press%','%seven seas%','%dynamite%','%vertigo%','%oni press%','%fantagraphics%','%tokyopop%','%square enix%']))`,
    wob.id)

  log('')
  log(`TM targets  : ${tmTargets.length.toLocaleString()} (of ${tmActive.length.toLocaleString()} active; ${tmExcluded} active row(s) not in sitemap — EXCLUDED)`)
  log(`WoB targets : ${wobTargets.length}`)
  log(`product requests intended: ${tmTargets.length + wobTargets.length} of ${TOTAL_PRODUCT_REQUESTS} ceiling`)
  const estMin = Math.round(((tmTargets.length + wobTargets.length) * (BETWEEN_PRODUCT_MS + 250)) / 60_000)
  log(`estimated wall clock: ~${estMin} min`)

  const tmCeiling = Number.isFinite(MAX_ROWS_ARG) ? Math.min(MAX_ROWS_ARG, TM_MAX_ROWS) : TM_MAX_ROWS
  if (tmTargets.length > tmCeiling)     { log(`SAFE STOP — TM targets ${tmTargets.length} > ceiling ${tmCeiling}`); await prisma.$disconnect(); process.exit(1) }
  if (wobTargets.length > WOB_MAX_ROWS) { log(`SAFE STOP — WoB targets ${wobTargets.length} > ceiling ${WOB_MAX_ROWS}`); await prisma.$disconnect(); process.exit(1) }
  if (tmTargets.length + wobTargets.length > TOTAL_TARGET_ROWS)      { log('SAFE STOP — total target row ceiling'); await prisma.$disconnect(); process.exit(1) }
  if (tmTargets.length + wobTargets.length > TOTAL_PRODUCT_REQUESTS) { log('SAFE STOP — base product request ceiling'); await prisma.$disconnect(); process.exit(1) }

  // ── Verification loop ────────────────────────────────────────────────────
  let consecutiveTransient = 0
  let breakerTripped: string | null = null

  async function runCohort(name: string, domain: string, rows: any[]): Promise<RowResult[]> {
    const out: RowResult[] = []
    log('')
    log(`verifying ${name}: ${rows.length.toLocaleString()} rows against ${domain}`)
    for (const [i, row] of rows.entries()) {
      if (breakerTripped) break
      if (productRequests >= TOTAL_PRODUCT_REQUESTS) { breakerTripped = 'total product request ceiling reached'; break }
      if (sitemapRequests + productRequests + retryRequests >= TOTAL_REQUESTS_MAX) {
        breakerTripped = `total request ceiling ${TOTAL_REQUESTS_MAX} reached`
        log(`SAFE STOP — ${breakerTripped}`)
        break
      }
      const r = await verifyRow(domain, row)
      if (WRITE) await writeRow(name, r)
      out.push(r)
      if (r.klass === 'transient') {
        consecutiveTransient++
        if (consecutiveTransient >= MAX_CONSECUTIVE_TRANSIENT) {
          breakerTripped = `${consecutiveTransient} consecutive transient failures on ${domain}`
          log(`BREAKER — ${breakerTripped}`)
          break
        }
      } else consecutiveTransient = 0

      const transientSoFar = out.filter(x => x.klass === 'transient').length
      if (out.length >= TRANSIENT_RATE_MIN_SAMPLE && transientSoFar / out.length > TRANSIENT_RATE_LIMIT) {
        breakerTripped = `transient failure rate ${(transientSoFar / out.length * 100).toFixed(1)}% on ${domain}`
        log(`BREAKER — ${breakerTripped}`)
        break
      }

      if ((i + 1) % 250 === 0) {
        log(`  ${i + 1}/${rows.length} · unchanged ${tally(out, 'availableUnchanged')} · changed ${tally(out, 'availablePriceChanged')} · unavailable ${tally(out, 'unavailable')} · transient ${transientSoFar}${WRITE ? ` · written ${rowsWritten}` : ''}`)
      }
      await sleep(BETWEEN_PRODUCT_MS)
    }
    return out
  }

  const tmResults  = await runCohort('Travelling Man', TM_DOMAIN, tmTargets)
  const wobResults = breakerTripped ? [] : await runCohort('World of Books', WOB_DOMAIN, wobTargets)

  // ── Report ───────────────────────────────────────────────────────────────
  const summarise = (rs: RowResult[], targets: number) => {
    const verified = tally(rs, 'availableUnchanged') + tally(rs, 'availablePriceChanged') + tally(rs, 'unavailable')
    return {
      targetRows: targets,
      rowsAttempted: rs.length,
      successfulExactVerifications: verified,
      availableUnchangedPrice: tally(rs, 'availableUnchanged'),
      availablePriceChanged:   tally(rs, 'availablePriceChanged'),
      unavailable:             tally(rs, 'unavailable'),
      variantMissing:          tally(rs, 'variantMissing'),
      productIdMismatch:       tally(rs, 'productIdMismatch'),
      notFound404:             tally(rs, 'notFound'),
      transientFailures:       tally(rs, 'transient'),
      otherErrors:             tally(rs, 'otherError'),
      // Only a proven live read may licence a later freshness/price write.
      safeForSubsequentWrite:  verified,
      mustNotBeRefreshed:      rs.length - verified + (targets - rs.length),
      rowsWritten:             rs.filter(r => r.written === true).length,
    }
  }

  const after = WRITE ? await snapshot() : before
  const wallMs = Date.now() - t0
  const report = {
    version: 2, runAt: new Date().toISOString(),
    mode: WRITE ? 'WRITE (bounded, verified-in-run only)' : 'DRY-RUN (read-only, zero writes)',
    breakerTripped,
    bounds: { TM_MAX_ROWS, WOB_MAX_ROWS, TOTAL_TARGET_ROWS, TOTAL_PRODUCT_REQUESTS, TOTAL_REQUESTS_MAX, BETWEEN_PRODUCT_MS, MAX_RETRIES, MAX_PRICE_RATIO },
    enumeration: { source: 'sitemap index + product sitemaps', filesDiscovered: files.length, filesFetched, distinctHandles: handles.size, complete: filesFetched === files.length },
    travellingMan: { ...summarise(tmResults, tmTargets.length), activeRowsExcludedNotInSitemap: tmExcluded, scheduledSyncDisabled: tmCfg.scheduled_sync_disabled ?? null },
    worldOfBooks: summarise(wobResults, wobTargets.length),
    priceChanges,
    writeTotals: {
      rowsWritten, priceHistoryRowsCreated: priceHistoryRows,
      skippedRowNotActive: writeSkippedNotActive,
      excludedImplausiblePrice: excludedImplausible,
      listingsCreated: 0, canonicalProductsCreated: 0,
      deletedRowsTouched: 0, deletedAtCleared: 0,
      retailerLastSyncedAtTouched: 0, syncLogsCreated: 0,
    },
    productionState: { before, after },
    cost: {
      sitemapRequests, productRequests, retryRequests,
      totalHttpRequests: sitemapRequests + productRequests + retryRequests,
      inboundBytes, inboundMiB: Number((inboundBytes / 1048576).toFixed(2)),
      wallClockMs: wallMs, wallClockMin: Number((wallMs / 60000).toFixed(1)),
      inngestExecutions: 0, externalApiCostGBP: 0,
    },
    softDeletedTmRowsTouched: 0,
  }

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(report, null, 2))

  const show = (label: string, s: ReturnType<typeof summarise>) => {
    log('')
    log(`── ${label} ─────────────────────────────`)
    log(`target rows                  : ${s.targetRows.toLocaleString()}`)
    log(`rows attempted               : ${s.rowsAttempted.toLocaleString()}`)
    log(`exact verifications          : ${s.successfulExactVerifications.toLocaleString()}`)
    log(`  available, price unchanged : ${s.availableUnchangedPrice.toLocaleString()}`)
    log(`  available, price CHANGED   : ${s.availablePriceChanged.toLocaleString()}`)
    log(`  unavailable                : ${s.unavailable.toLocaleString()}`)
    log(`stored variant missing       : ${s.variantMissing.toLocaleString()}`)
    log(`product id mismatch          : ${s.productIdMismatch.toLocaleString()}`)
    log(`404 not found                : ${s.notFound404.toLocaleString()}`)
    log(`transient/throttle failures  : ${s.transientFailures.toLocaleString()}`)
    log(`other errors                 : ${s.otherErrors.toLocaleString()}`)
    log(`safe for write               : ${s.safeForSubsequentWrite.toLocaleString()}`)
    log(`must NOT be refreshed        : ${s.mustNotBeRefreshed.toLocaleString()}`)
    log(`ROWS ACTUALLY WRITTEN        : ${s.rowsWritten.toLocaleString()}`)
  }
  show('TRAVELLING MAN', report.travellingMan as any)
  show('WORLD OF BOOKS', report.worldOfBooks as any)

  if (priceChanges.length > 0) {
    log('')
    log('── PRICE CHANGES ─────────────────────────────')
    for (const c of priceChanges) {
      log(`${c.retailer} · ${c.listingId} · sku ${c.sku} · £${c.oldPrice.toFixed(2)} -> £${c.newPrice.toFixed(2)} · `
        + `${c.absDiff >= 0 ? '+' : ''}£${c.absDiff.toFixed(2)} (${c.pctDiff >= 0 ? '+' : ''}${c.pctDiff}%) · `
        + `${c.written ? 'WRITTEN' : `NOT WRITTEN (${c.excludedReason ?? 'n/a'})`}`)
    }
    const inc = priceChanges.filter(c => c.absDiff > 0).length
    const dec = priceChanges.filter(c => c.absDiff < 0).length
    const largest = priceChanges.reduce((a, b) => Math.abs(b.absDiff) > Math.abs(a.absDiff) ? b : a)
    log(`increases ${inc} · decreases ${dec} · largest £${largest.absDiff.toFixed(2)} (${largest.pctDiff}%) on ${largest.listingId}`)
  }

  if (WRITE) {
    log('')
    log('── WRITE TOTALS ─────────────────────────────')
    log(`rows written                 : ${rowsWritten.toLocaleString()}`)
    log(`price_history rows created   : ${priceHistoryRows}`)
    log(`skipped (row not active)     : ${writeSkippedNotActive}`)
    log(`excluded (implausible price) : ${excludedImplausible}`)
    log(`listings/canonicals created  : 0 / 0`)
    log('')
    log('── PRODUCTION STATE before -> after ─────────')
    for (const d of [TM_DOMAIN, WOB_DOMAIN]) {
      const b = before[d], a = after[d]
      log(`${d}: active ${b.active}->${a.active} · deleted ${b.deleted}->${a.deleted} · in-stock ${b.inStock}->${a.inStock} · oos ${b.outOfStock}->${a.outOfStock}`)
      log(`  max last_seen ${b.maxLastSeenAt} -> ${a.maxLastSeenAt}`)
      log(`  lastSyncedAt  ${b.lastSyncedAt} -> ${a.lastSyncedAt}  (must be unchanged)`)
      log(`  sync_logs     ${b.syncLogs} -> ${a.syncLogs}  (must be unchanged) · scheduled_sync_disabled ${JSON.stringify(a.scheduledSyncDisabled)}`)
    }
    log(`canonical_products ${before.canonicalProducts} -> ${after.canonicalProducts} · retailer_listings ${before.retailerListings} -> ${after.retailerListings} · price_history ${before.priceHistory} -> ${after.priceHistory}`)
  }

  log('')
  log(`http: ${sitemapRequests} sitemap + ${productRequests} product + ${retryRequests} retries = ${report.cost.totalHttpRequests}`)
  log(`inbound ${report.cost.inboundMiB} MiB · wall clock ${report.cost.wallClockMin} min · inngest 0 · rows written ${WRITE ? rowsWritten : 0}`)
  if (breakerTripped) log(`BREAKER TRIPPED: ${breakerTripped}`)
  log(`-> ${OUT}`)

  await prisma.$disconnect()
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
