/**
 * b4-revive-verified-offers.ts — bounded recovery for launch-plan blocker B4.
 *
 * DEFAULT MODE IS READ-ONLY. Writes happen only with an explicit --write flag.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT THE NORMAL REFRESH
 * ─────────────────────────────────────────────────────
 * scripts/price-verify-dryrun.ts scopes every update `deletedAt: null`, so a
 * soft-deleted row is unreachable by construction. That guard is correct and is
 * NOT changed — it is what stops a routine refresh resurrecting dead stock.
 *
 * But on 2026-10-27 at 03:00:46.263 UTC the retention sweep
 * (lib/inngest/functions/cleanup-stale.ts) ran its two passes against the same
 * `lastSeenAt < 30 days` predicate: pass 1 flipped 2,246 Travelling Man rows to
 * OUT_OF_STOCK, pass 2 soft-deleted them moments later. With zero active rows
 * left, the normal refresh has nothing to refresh, and the site shows no prices
 * at all. Reviving requires clearing deleted_at — a thing the normal path must
 * never do, and this script does only for rows that verified LIVE AND AVAILABLE
 * in the same run.
 *
 * The stored OUT_OF_STOCK is an artefact of that sweep's pass 1, not evidence
 * about Travelling Man's real stock, so it is deliberately NOT used as a
 * signal. Live verification is the only truth here.
 *
 * SCOPE — pinned in SQL, not in logic
 * ───────────────────────────────────
 * Exactly one deletion cohort is reachable: deleted_at = the single 27 October
 * sweep timestamp. The 15,922 rows suppressed manually at 14:37 on 13 May (not
 * a 03:00 cron timestamp) and every other sweep are excluded by construction —
 * every UPDATE is scoped `deletedAt: SWEEP_AT`, so even a logic error upstream
 * cannot reach one.
 *
 * EVIDENCE REQUIRED BEFORE A ROW IS PUBLISHED
 * ───────────────────────────────────────────
 * A fresh response from https://<domain>/products/<handle>.js in THIS run, in
 * which the live product id equals the stored product id, the stored variant
 * exists (no substitution), the variant is `available: true`, and the price is
 * plausible. A sitemap entry is never evidence of a price, and this script does
 * not read the sitemap at all. A failed request is never fresh and never
 * out-of-stock: it gets its own class and cannot be published.
 *
 * Sold-out editions are NOT revived. They verified truthfully, and a sold-out
 * offer must not reach a purchasable rail — they stay soft-deleted.
 *
 * IDEMPOTENCY
 * ───────────
 * Selection requires deleted_at = SWEEP_AT. A published row has deleted_at
 * NULL, so a second run cannot select it: no duplicate listing, no duplicate
 * observation. Proven by running twice and diffing the counts.
 *
 * GUARANTEES IN BOTH MODES
 * ────────────────────────
 * 0 listings created · 0 canonical products created · 0 matcher calls ·
 * 0 Inngest executions · retailer.lastSyncedAt untouched (it means a COMPLETE
 * sync) · no row outside the sweep cohort touched · at most MAX_PUBLISHED rows
 * revived. In default mode, additionally 0 writes of any kind.
 *
 * Run (read-only):
 *   npx dotenv -e <main>/.env.local -- npx tsx scripts/b4-revive-verified-offers.ts
 * Run (bounded write, founder-approved ceiling of 10):
 *   npx dotenv -e <main>/.env.local -- npx tsx scripts/b4-revive-verified-offers.ts --write
 */
import { PrismaClient, Prisma }     from '@prisma/client'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join }            from 'node:path'

import {
  cost, verifyRow, isImplausiblePrice, resetCost,
  PURCHASABLE_KLASSES, MAX_PRICE_RATIO, MAX_RETRIES,
  type VerifyKlass, type VerifyRowResult,
} from '@/lib/retailers/shopify-verify'

const prisma = new PrismaClient()

const argv  = process.argv.slice(2)
const WRITE = argv.includes('--write')

/** The single sweep transaction this recovery is allowed to reverse. */
const SWEEP_AT = new Date('2026-10-27T03:00:46.263Z')
const TM_DOMAIN = 'travellingman.com'

// ── Hard ceilings, asserted before the first product request ────────────────
/** Rows considered, and therefore the maximum product requests. */
const MAX_CANDIDATES = 40
/** The founder-approved publication ceiling. */
const MAX_PUBLISHED  = 10
const BETWEEN_PRODUCT_MS = 1_000   // strictly sequential, 1 req/s
const MAX_RUNTIME_MS     = 5 * 60_000

// ── Circuit breaker ─────────────────────────────────────────────────────────
const MAX_CONSECUTIVE_TRANSIENT = 8
const TRANSIENT_RATE_LIMIT      = 0.05
const TRANSIENT_RATE_MIN_SAMPLE = 20

const OUT = join(process.cwd(), 'launch', 'operations',
  WRITE ? 'b4-revive-write-latest.json' : 'b4-revive-dryrun-latest.json')

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const log   = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`)
const n     = (v: unknown) => Number(v)

interface Candidate {
  id: string
  retailer_sku: string
  retailer_url: string
  price_amount: Prisma.Decimal
  canonical_slug: string
  title: string
  format: string
  publisher: string | null
  listing_isbn: string | null
  product_isbn: string | null
  other_priced_retailers: number
}

interface Outcome extends VerifyRowResult {
  slug: string
  title: string
  isbn: string | null
  published: boolean
  skipReason?: string
  /** Endpoint + status recorded for every failed provider request. */
  failure?: { endpoint: string; klass: VerifyKlass; effect: string }
}

/** Baseline / final snapshot of the three numbers B4's "done" condition names. */
async function snapshot() {
  const [priced]   = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c FROM retailer_listings
    WHERE deleted_at IS NULL AND price_amount > 0`
  const [products] = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(DISTINCT canonical_product_id)::bigint AS c FROM retailer_listings
    WHERE deleted_at IS NULL AND price_amount > 0 AND canonical_product_id IS NOT NULL`
  const [two]      = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c FROM (
      SELECT canonical_product_id FROM retailer_listings
      WHERE deleted_at IS NULL AND price_amount > 0 AND canonical_product_id IS NOT NULL
      GROUP BY canonical_product_id HAVING COUNT(DISTINCT retailer_id) >= 2) t`
  const [hist]     = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c FROM price_history`
  const [listings] = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c FROM retailer_listings`
  const [canon]    = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c FROM canonical_products`
  const [cohort]   = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c FROM retailer_listings rl
    JOIN retailers r ON r.id = rl.retailer_id
    WHERE r.domain = ${TM_DOMAIN} AND rl.deleted_at = ${SWEEP_AT}`
  const [tmActive] = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c FROM retailer_listings rl
    JOIN retailers r ON r.id = rl.retailer_id
    WHERE r.domain = ${TM_DOMAIN} AND rl.deleted_at IS NULL`
  return {
    pricedListings:         n(priced.c),
    pricedProducts:         n(products.c),
    productsAtTwoRetailers: n(two.c),
    priceHistoryRows:       n(hist.c),
    retailerListings:       n(listings.c),
    canonicalProducts:      n(canon.c),
    sweepCohortStillDeleted: n(cohort.c),
    tmActiveRows:           n(tmActive.c),
  }
}

async function main() {
  const t0 = Date.now()
  resetCost()

  log('── INTENDED WORK (printed before any product request) ──────────────────')
  log(`MODE: ${WRITE ? `WRITE (bounded: at most ${MAX_PUBLISHED} rows revived)` : 'DRY-RUN (read-only, default)'}`)
  log(`scope: domain ${TM_DOMAIN} · deleted_at = ${SWEEP_AT.toISOString()} ONLY`)
  log(`ceilings: candidates <= ${MAX_CANDIDATES} · product requests <= ${MAX_CANDIDATES} · published <= ${MAX_PUBLISHED}`)
  log(`pacing: ${BETWEEN_PRODUCT_MS}ms sequential, no concurrency · retries <= ${MAX_RETRIES} · runtime <= ${MAX_RUNTIME_MS / 1000}s`)
  log(`guards: price ratio <= ${MAX_PRICE_RATIO}x · sold-out never revived · updates scoped deletedAt = SWEEP_AT`)
  log(`        0 creates · 0 matcher · 0 inngest · retailer.lastSyncedAt untouched`)

  const before = await snapshot()
  log('')
  log(`BEFORE: priced listings ${before.pricedListings} · priced products ${before.pricedProducts} · products at 2+ retailers ${before.productsAtTwoRetailers}`)
  log(`        sweep cohort still deleted ${before.sweepCohortStillDeleted} · TM active rows ${before.tmActiveRows}`)

  const retailer = await prisma.retailer.findFirst({
    where: { domain: TM_DOMAIN }, select: { id: true, name: true, currency: true },
  })
  if (!retailer) throw new Error(`retailer ${TM_DOMAIN} not found`)

  // ── Candidate selection ───────────────────────────────────────────────────
  // Stored stock_status is uniformly OUT_OF_STOCK across this cohort (the
  // sweep's pass 1 set it), so it carries no information and is not used.
  // Ranked by overlap with another retailer holding a priced row for the same
  // edition, then price descending.
  const candidates = await prisma.$queryRaw<Candidate[]>`
    SELECT rl.id, rl.retailer_sku, rl.retailer_url, rl.price_amount,
           rl.isbn_13 AS listing_isbn,
           cp.canonical_slug, cp.title, cp.format::text AS format,
           cp.publisher, cp.isbn_13 AS product_isbn,
           (SELECT COUNT(DISTINCT o.retailer_id)::int FROM retailer_listings o
              WHERE o.canonical_product_id = rl.canonical_product_id
                AND o.retailer_id <> rl.retailer_id
                AND o.price_amount > 0) AS other_priced_retailers
    FROM retailer_listings rl
    JOIN retailers r           ON r.id  = rl.retailer_id
    JOIN canonical_products cp ON cp.id = rl.canonical_product_id
    WHERE r.domain = ${TM_DOMAIN}
      AND rl.deleted_at = ${SWEEP_AT}
      AND rl.price_amount > 0
      AND (rl.isbn_13 IS NOT NULL OR cp.isbn_13 IS NOT NULL)
    ORDER BY (SELECT COUNT(DISTINCT o.retailer_id) FROM retailer_listings o
                WHERE o.canonical_product_id = rl.canonical_product_id
                  AND o.retailer_id <> rl.retailer_id
                  AND o.price_amount > 0) DESC,
             rl.price_amount DESC
    LIMIT ${MAX_CANDIDATES}`

  log('')
  log(`${candidates.length} candidates selected (ceiling ${MAX_CANDIDATES})`)

  // ── Verify, then publish the first MAX_PUBLISHED that are genuinely buyable
  const outcomes: Outcome[] = []
  let published = 0, consecutiveTransient = 0, transientTotal = 0
  let breakerTripped: string | null = null
  let historyRows = 0

  for (const c of candidates) {
    if (published >= MAX_PUBLISHED) { log(`reached publication ceiling ${MAX_PUBLISHED} — stopping`); break }
    if (cost.productRequests >= MAX_CANDIDATES) { breakerTripped = 'product request ceiling reached'; break }
    if (Date.now() - t0 > MAX_RUNTIME_MS) { breakerTripped = 'runtime ceiling reached'; break }

    const stored = String(c.price_amount)
    const r = await verifyRow(TM_DOMAIN, {
      id: c.id, retailerSku: c.retailer_sku, retailerUrl: c.retailer_url, priceAmount: stored,
    })
    const isbn = c.listing_isbn ?? c.product_isbn
    const o: Outcome = { ...r, slug: c.canonical_slug, title: c.title, isbn, published: false }

    if (r.klass === 'transient') {
      consecutiveTransient++; transientTotal++
      o.failure = {
        endpoint: `https://${TM_DOMAIN}/products/<handle>.js`,
        klass: r.klass,
        effect: 'not published — a failed request is never treated as fresh or as out-of-stock',
      }
      if (consecutiveTransient >= MAX_CONSECUTIVE_TRANSIENT) {
        breakerTripped = `${consecutiveTransient} consecutive transient failures`
        outcomes.push(o); log(`SAFE STOP — ${breakerTripped}`); break
      }
      if (cost.productRequests >= TRANSIENT_RATE_MIN_SAMPLE &&
          transientTotal / cost.productRequests > TRANSIENT_RATE_LIMIT) {
        breakerTripped = `transient rate above ${TRANSIENT_RATE_LIMIT * 100}%`
        outcomes.push(o); log(`SAFE STOP — ${breakerTripped}`); break
      }
    } else {
      consecutiveTransient = 0
    }

    if (r.klass === 'unavailable') {
      o.skipReason = 'sold out live — left soft-deleted, never published as purchasable'
    } else if (!PURCHASABLE_KLASSES.includes(r.klass)) {
      o.skipReason = `unverified (${r.klass})`
      if (r.klass !== 'transient') {
        o.failure = {
          endpoint: `https://${TM_DOMAIN}/products/<handle>.js`,
          klass: r.klass,
          effect: 'not published — identity or availability could not be proven',
        }
      }
    } else if (r.live === null) {
      o.skipReason = 'no live price'
    } else if (isImplausiblePrice(Number(stored), Number(r.live))) {
      o.skipReason = `implausible price (${stored} -> ${r.live}) — refused by the ${MAX_PRICE_RATIO}x guard`
    } else if (WRITE) {
      const now = new Date()
      const priceChanged = Number(r.live) !== Number(stored)
      // Scoped to the ONE sweep cohort: a manually suppressed row or any other
      // deletion cannot match, whatever happened upstream.
      const res = await prisma.retailerListing.updateMany({
        where: { id: c.id, retailerId: retailer.id, deletedAt: SWEEP_AT },
        data: {
          deletedAt:   null,
          priceAmount: new Prisma.Decimal(r.live),
          stockStatus: 'IN_STOCK',
          lastSeenAt:  now,
          ...(priceChanged ? { lastPriceChangeAt: now } : {}),
        },
      })
      if (res.count !== 1) {
        o.skipReason = `updateMany matched ${res.count} rows in the sweep cohort — not published`
      } else {
        // Every revived row changes stock status (OUT_OF_STOCK -> IN_STOCK), so
        // by the existing "append on a genuine change" rule each earns exactly
        // one observation. A second run cannot select the row again, so this
        // cannot duplicate.
        await prisma.priceHistory.create({
          data: {
            retailerListingId: c.id,
            priceAmount:       new Prisma.Decimal(r.live),
            priceCurrency:     'GBP',
            stockStatus:       'IN_STOCK',
            recordedAt:        now,
          },
        })
        historyRows++
        o.published = true
        published++
      }
    } else {
      o.skipReason = 'eligible — would be published with --write'
      published++   // count against the ceiling so the dry run previews truthfully
    }

    outcomes.push(o)
    log(`  ${o.published ? 'PUBLISHED' : (PURCHASABLE_KLASSES.includes(r.klass) ? 'ELIGIBLE ' : 'skip     ')} ` +
        `£${stored}->${r.live ?? '—'} ${r.klass.padEnd(22)} ${c.title.slice(0, 44)}`)

    await sleep(BETWEEN_PRODUCT_MS)
  }

  const after = await snapshot()
  const wallMs = Date.now() - t0

  const tally = (k: VerifyKlass) => outcomes.filter(o => o.klass === k).length
  const report = {
    version: 1,
    runAt: new Date().toISOString(),
    mode: WRITE ? `WRITE (bounded, verified-in-run only, ceiling ${MAX_PUBLISHED})` : 'DRY-RUN (read-only, zero writes)',
    sweepAt: SWEEP_AT.toISOString(),
    breakerTripped,
    bounds: { MAX_CANDIDATES, MAX_PUBLISHED, BETWEEN_PRODUCT_MS, MAX_RUNTIME_MS, MAX_RETRIES, MAX_PRICE_RATIO },
    evidenceRule: 'fresh /products/<handle>.js response in this run; exact product id and stored variant; available:true; plausible price. Sitemap never used as price evidence.',
    candidatesConsidered: candidates.length,
    verification: {
      availableUnchanged:    tally('availableUnchanged'),
      availablePriceChanged: tally('availablePriceChanged'),
      unavailableLeftDeleted: tally('unavailable'),
      variantMissing:        tally('variantMissing'),
      productIdMismatch:     tally('productIdMismatch'),
      notFound404:           tally('notFound'),
      transientFailures:     tally('transient'),
      otherErrors:           tally('otherError'),
    },
    published: outcomes.filter(o => o.published).length,
    writeTotals: {
      rowsRevived:              outcomes.filter(o => o.published).length,
      priceHistoryRowsCreated:  historyRows,
      listingsCreated:          0,
      canonicalProductsCreated: 0,
      matcherCalls:             0,
      inngestExecutions:        0,
      retailerLastSyncedAtTouched: 0,
      rowsTouchedOutsideSweepCohort: 0,
    },
    productionState: { before, after },
    cost: {
      productRequests: cost.productRequests,
      retryRequests:   cost.retryRequests,
      totalHttpRequests: cost.productRequests + cost.retryRequests,
      inboundMiB: Number((cost.inboundBytes / 1048576).toFixed(2)),
      wallClockMs: wallMs, wallClockMin: Number((wallMs / 60000).toFixed(1)),
      externalApiCostGBP: 0,
    },
    outcomes,
  }

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(report, null, 2))

  log('')
  log(`AFTER:  priced listings ${after.pricedListings} · priced products ${after.pricedProducts} · products at 2+ retailers ${after.productsAtTwoRetailers}`)
  log(`        sweep cohort still deleted ${after.sweepCohortStillDeleted} (was ${before.sweepCohortStillDeleted}) · TM active ${after.tmActiveRows} (was ${before.tmActiveRows})`)
  log(`        price_history ${before.priceHistoryRows} -> ${after.priceHistoryRows} · retailer_listings ${before.retailerListings} -> ${after.retailerListings} (must be unchanged)`)
  log(`        canonical_products ${before.canonicalProducts} -> ${after.canonicalProducts} (must be unchanged)`)
  log('')
  log(`verified available ${report.verification.availableUnchanged + report.verification.availablePriceChanged} · sold out ${report.verification.unavailableLeftDeleted} · 404 ${report.verification.notFound404} · transient ${report.verification.transientFailures}`)
  log(`http ${report.cost.totalHttpRequests} requests · ${report.cost.inboundMiB} MiB · ${report.cost.wallClockMin} min`)
  if (breakerTripped) log(`BREAKER TRIPPED: ${breakerTripped}`)
  log(`-> ${OUT}`)

  await prisma.$disconnect()
}

main().catch(async e => {
  await prisma.$disconnect()
  console.error(e)
  process.exit(1)
})
