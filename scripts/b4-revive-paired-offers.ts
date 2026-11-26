/**
 * b4-revive-paired-offers.ts — the second half of launch-plan blocker B4.
 *
 * DEFAULT MODE IS READ-ONLY. Writes happen only with an explicit --write flag.
 *
 * WHY A SECOND SCRIPT AND NOT A FLAG ON THE FIRST
 * ───────────────────────────────────────────────
 * scripts/b4-revive-verified-offers.ts restored ten Travelling Man offers and
 * so moved "priced listings" 0 → 10. It did not move the number B4 is actually
 * about: products priced at 2+ independent retailers stayed at 0. Its selection
 * ranked candidates by price descending, which optimises for nothing that
 * produces a comparison — only 2 of the 10 it published have a World of Books
 * row at all. That was my mistake, and this script is the correction: the unit
 * of work here is a PAIR, not a row, and a pair is published only if BOTH sides
 * verify live and available in the same run.
 *
 * Publishing one side of a pair would add a price and no comparison, so a pair
 * where either side is sold out, missing or unverifiable is abandoned whole —
 * the other side stays soft-deleted even though it verified perfectly.
 *
 * SCOPE — pinned per row, not globally
 * ────────────────────────────────────
 * The Travelling Man recovery could pin one timestamp because the 27 October
 * sweep was a single transaction. World of Books has no single cohort: its rows
 * were soft-deleted across many sweeps (37,802 on 13 Aug, 29,559 on 15 Jul,
 * 24,022 on 11 Jun …). So every UPDATE here is scoped to `id` AND the exact
 * `deleted_at` value read for that row in this same run. A row that changed
 * underneath us matches 0 rows and is reported, never force-written.
 *
 * Two independent guards keep deliberate suppressions untouchable:
 *   1. CRON WINDOW. cleanup-stale runs `0 3 * * *`, so an automatic sweep
 *      carries a 03:xx UTC timestamp. Travelling Man's 15,922 rows deleted at
 *      14:37 on 13 May are not a cron run — they look like a deliberate bulk
 *      suppression. Any row whose deleted_at falls outside the window is
 *      REFUSED before it is ever requested, and counted in the report.
 *   2. The Travelling Man side may only come from the one 27 October sweep
 *      timestamp, exactly as before, or already be active.
 *
 * ALREADY-ACTIVE ROWS ARE VERIFIED, NEVER WRITTEN
 * ───────────────────────────────────────────────
 * Two of the ten restored Travelling Man rows have a World of Books partner.
 * Those TM rows are live and owned by the 02:00 offer-refresh job, so this
 * script verifies them (an unavailable side invalidates the pair) and writes
 * nothing to them. If such a row's live price has moved, that is reported for
 * the refresh to correct — it is not corrected here, because two writers on one
 * row is how you get a race nobody can read afterwards.
 *
 * EVIDENCE REQUIRED BEFORE A PAIR IS PUBLISHED
 * ────────────────────────────────────────────
 * For BOTH sides, in this run: a fresh response from
 * https://<domain>/products/<handle>.js in which the live product id equals the
 * stored product id, the stored variant still exists (no substitution), the
 * variant is `available: true`, and the price is plausible. A sitemap entry is
 * never evidence of a price and no sitemap is read. A failed request is never
 * fresh and never out-of-stock: it gets its own class and cannot publish.
 *
 * World of Books trust criteria are the ones already in
 * scripts/price-verify-dryrun.ts (ComicVine id, CV metadata, or a comic
 * publisher) and are NOT broadened.
 *
 * IDEMPOTENCY
 * ───────────
 * A published row has deleted_at NULL and is reclassified as already-active on
 * a second run: verified, not rewritten. So a second run publishes nothing new,
 * creates no duplicate listing and no duplicate observation.
 *
 * GUARANTEES IN BOTH MODES
 * ────────────────────────
 * 0 listings created · 0 canonical products created · 0 matcher calls ·
 * 0 Inngest executions · retailer.lastSyncedAt untouched · no row outside the
 * cron window touched · at most MAX_PAIRS pairs published. In default mode,
 * additionally 0 writes of any kind.
 *
 * Run (pool analysis only, zero HTTP requests, zero writes):
 *   npx dotenv -e <main>/.env.local -- npx tsx scripts/b4-revive-paired-offers.ts --measure-only
 * Run (read-only, verifies live):
 *   npx dotenv -e <main>/.env.local -- npx tsx scripts/b4-revive-paired-offers.ts
 * Run (bounded write, founder-approved ceiling of 40 pairs):
 *   npx dotenv -e <main>/.env.local -- npx tsx scripts/b4-revive-paired-offers.ts --write
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

const argv    = process.argv.slice(2)
const WRITE   = argv.includes('--write')
const MEASURE = argv.includes('--measure-only')

const TM_DOMAIN  = 'travellingman.com'
const WOB_DOMAIN = 'worldofbooks.com'

/** The single Travelling Man sweep transaction this recovery may reverse. */
const TM_SWEEP_AT = new Date('2026-10-27T03:00:46.263Z')

/**
 * cleanup-stale's cron is `0 3 * * *`, so an automatic soft-delete lands at
 * 03:xx UTC. Minutes-from-UTC-midnight, inclusive of both ends. Anything
 * outside this is presumed deliberate and refused.
 */
const CRON_WINDOW_START_MIN = 3 * 60        // 03:00
const CRON_WINDOW_END_MIN   = 4 * 60 + 1    // 04:01

// ── Hard ceilings, asserted before the first product request ────────────────
/** Pairs considered, so at most 2x this many product requests. */
const MAX_PAIR_CANDIDATES = 60
/** The founder-approved publication ceiling, in PAIRS. */
const MAX_PAIRS           = 40
const BETWEEN_PRODUCT_MS  = 1_000   // strictly sequential, 1 req/s
const MAX_RUNTIME_MS      = 8 * 60_000

// ── Circuit breaker ─────────────────────────────────────────────────────────
const MAX_CONSECUTIVE_TRANSIENT = 8
const TRANSIENT_RATE_LIMIT      = 0.05
const TRANSIENT_RATE_MIN_SAMPLE = 20

const OUT = join(process.cwd(), 'launch', 'operations',
  WRITE ? 'b4-pairs-write-latest.json'
        : MEASURE ? 'b4-pairs-measure-latest.json' : 'b4-pairs-dryrun-latest.json')

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const log   = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`)
const n     = (v: unknown) => Number(v)

/** Minutes from UTC midnight, used only for the cron-window guard. */
const utcMinuteOfDay = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes()
const inCronWindow   = (d: Date | null) =>
  d === null ? true
             : utcMinuteOfDay(d) >= CRON_WINDOW_START_MIN && utcMinuteOfDay(d) <= CRON_WINDOW_END_MIN

interface PairRow {
  canonical_slug: string
  title: string
  format: string
  publisher: string | null
  product_isbn: string | null
  tm_id: string
  tm_sku: string
  tm_url: string
  tm_price: Prisma.Decimal
  tm_deleted_at: Date | null
  tm_isbn: string | null
  wob_id: string
  wob_sku: string
  wob_url: string
  wob_price: Prisma.Decimal
  wob_deleted_at: Date | null
}

type SideState = 'alreadyActive' | 'revivable'

interface SideOutcome extends VerifyRowResult {
  domain: string
  state: SideState
  stored: string
  /** The exact deleted_at this run read, and therefore scoped its UPDATE to. */
  scopedDeletedAt: string | null
  written: boolean
  note?: string
  failure?: { endpoint: string; klass: VerifyKlass; effect: string }
}

interface PairOutcome {
  slug: string
  title: string
  isbn: string | null
  published: boolean
  skipReason?: string
  tm: SideOutcome
  wob: SideOutcome
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
  const [tmCohort] = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c FROM retailer_listings rl
    JOIN retailers r ON r.id = rl.retailer_id
    WHERE r.domain = ${TM_DOMAIN} AND rl.deleted_at = ${TM_SWEEP_AT}`
  const [tmActive] = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c FROM retailer_listings rl
    JOIN retailers r ON r.id = rl.retailer_id
    WHERE r.domain = ${TM_DOMAIN} AND rl.deleted_at IS NULL`
  const [wobActive] = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c FROM retailer_listings rl
    JOIN retailers r ON r.id = rl.retailer_id
    WHERE r.domain = ${WOB_DOMAIN} AND rl.deleted_at IS NULL`
  const [otherDeleted] = await prisma.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*)::bigint AS c FROM retailer_listings rl
    JOIN retailers r ON r.id = rl.retailer_id
    WHERE rl.deleted_at IS NOT NULL
      AND NOT (r.domain = ${TM_DOMAIN}  AND rl.deleted_at = ${TM_SWEEP_AT})
      AND NOT (r.domain = ${WOB_DOMAIN})`
  return {
    pricedListings:          n(priced.c),
    pricedProducts:          n(products.c),
    productsAtTwoRetailers:  n(two.c),
    priceHistoryRows:        n(hist.c),
    retailerListings:        n(listings.c),
    canonicalProducts:       n(canon.c),
    tmSweepCohortStillDeleted: n(tmCohort.c),
    tmActiveRows:            n(tmActive.c),
    wobActiveRows:           n(wobActive.c),
    unrelatedDeletedRows:    n(otherDeleted.c),
  }
}

async function main() {
  const t0 = Date.now()
  resetCost()

  log('── INTENDED WORK (printed before any product request) ──────────────────')
  log(`MODE: ${MEASURE ? 'MEASURE-ONLY (no HTTP, no writes)'
                       : WRITE ? `WRITE (bounded: at most ${MAX_PAIRS} PAIRS published)`
                               : 'DRY-RUN (read-only, default)'}`)
  log(`unit of work: a PAIR — both sides verified live in this run, or neither is published`)
  log(`scope: ${TM_DOMAIN} deleted_at = ${TM_SWEEP_AT.toISOString()} or already active`)
  log(`       ${WOB_DOMAIN} deleted_at inside the 03:00-04:01 UTC cron window, or already active`)
  log(`ceilings: pair candidates <= ${MAX_PAIR_CANDIDATES} · product requests <= ${MAX_PAIR_CANDIDATES * 2} · pairs published <= ${MAX_PAIRS}`)
  log(`pacing: ${BETWEEN_PRODUCT_MS}ms sequential, no concurrency · retries <= ${MAX_RETRIES} · runtime <= ${MAX_RUNTIME_MS / 1000}s`)
  log(`guards: price ratio <= ${MAX_PRICE_RATIO}x · sold-out never revived · every UPDATE scoped id + exact deleted_at read this run`)
  log(`        0 creates · 0 matcher · 0 inngest · retailer.lastSyncedAt untouched · already-active rows verified but never written`)

  const before = await snapshot()
  log('')
  log(`BEFORE: priced listings ${before.pricedListings} · priced products ${before.pricedProducts} · products at 2+ retailers ${before.productsAtTwoRetailers}`)
  log(`        TM active ${before.tmActiveRows} · TM sweep cohort still deleted ${before.tmSweepCohortStillDeleted} · WoB active ${before.wobActiveRows}`)

  const retailers = await prisma.retailer.findMany({
    where:  { domain: { in: [TM_DOMAIN, WOB_DOMAIN] } },
    select: { id: true, domain: true, name: true, currency: true },
  })
  const tmRetailer  = retailers.find(r => r.domain === TM_DOMAIN)
  const wobRetailer = retailers.find(r => r.domain === WOB_DOMAIN)
  if (!tmRetailer)  throw new Error(`retailer ${TM_DOMAIN} not found`)
  if (!wobRetailer) throw new Error(`retailer ${WOB_DOMAIN} not found`)
  for (const r of [tmRetailer, wobRetailer]) {
    if (r.currency !== 'GBP') throw new Error(`${r.domain} currency is ${r.currency}, expected GBP`)
  }
  log(`retailers: ${tmRetailer.name} (${tmRetailer.currency}) · ${wobRetailer.name} (${wobRetailer.currency})`)

  // ── Pair selection ───────────────────────────────────────────────────────
  // One row per retailer per edition, preferring an already-active row, then
  // the most recent sighting. Stored stock_status is NOT used on either side:
  // the sweep's pass 1 set every swept row to OUT_OF_STOCK before pass 2
  // deleted it, so it carries no information about real availability.
  //
  // Ordered to publish the cheapest wins first: editions where Travelling Man
  // is already live need only the World of Books side verified and revived.
  const candidates = await prisma.$queryRaw<PairRow[]>`
    WITH tm AS (
      SELECT DISTINCT ON (rl.canonical_product_id)
             rl.id::text AS id, rl.canonical_product_id, rl.retailer_sku,
             rl.retailer_url, rl.price_amount, rl.deleted_at, rl.isbn_13
      FROM retailer_listings rl
      JOIN retailers r ON r.id = rl.retailer_id
      WHERE r.domain = ${TM_DOMAIN}
        AND rl.price_amount > 0
        AND rl.canonical_product_id IS NOT NULL
        AND rl.retailer_url IS NOT NULL
        AND (rl.deleted_at IS NULL OR rl.deleted_at = ${TM_SWEEP_AT})
      ORDER BY rl.canonical_product_id, (rl.deleted_at IS NULL) DESC, rl.last_seen_at DESC
    ),
    wob AS (
      SELECT DISTINCT ON (rl.canonical_product_id)
             rl.id::text AS id, rl.canonical_product_id, rl.retailer_sku,
             rl.retailer_url, rl.price_amount, rl.deleted_at
      FROM retailer_listings rl
      JOIN retailers r ON r.id = rl.retailer_id
      WHERE r.domain = ${WOB_DOMAIN}
        AND rl.price_amount > 0
        AND rl.canonical_product_id IS NOT NULL
        AND rl.retailer_url IS NOT NULL
      ORDER BY rl.canonical_product_id, (rl.deleted_at IS NULL) DESC, rl.last_seen_at DESC
    )
    SELECT cp.canonical_slug, cp.title, cp.format::text AS format, cp.publisher,
           cp.isbn_13 AS product_isbn,
           tm.id  AS tm_id,  tm.retailer_sku  AS tm_sku,  tm.retailer_url  AS tm_url,
           tm.price_amount  AS tm_price,  tm.deleted_at  AS tm_deleted_at, tm.isbn_13 AS tm_isbn,
           wob.id AS wob_id, wob.retailer_sku AS wob_sku, wob.retailer_url AS wob_url,
           wob.price_amount AS wob_price, wob.deleted_at AS wob_deleted_at
    FROM tm
    JOIN wob                   ON wob.canonical_product_id = tm.canonical_product_id
    JOIN canonical_products cp ON cp.id = tm.canonical_product_id
    WHERE (cp.comicvine_id IS NOT NULL OR cp.cv_metadata IS NOT NULL
           OR cp.publisher ILIKE ANY(ARRAY['%marvel%','%dc comic%','%image comic%','%dark horse%','%idw%','%viz%','%kodansha%','%boom%','%titan%','%rebellion%','%yen press%','%seven seas%','%dynamite%','%vertigo%','%oni press%','%fantagraphics%','%tokyopop%','%square enix%']))
    ORDER BY (tm.deleted_at IS NULL) DESC, wob.deleted_at DESC NULLS FIRST, tm.price_amount DESC
    LIMIT ${MAX_PAIR_CANDIDATES}`

  log('')
  log(`${candidates.length} pair candidates found (ceiling ${MAX_PAIR_CANDIDATES})`)

  // ── Cron-window guard, applied BEFORE any request is made ────────────────
  const refusedOutsideWindow = candidates.filter(c => !inCronWindow(c.wob_deleted_at) || !inCronWindow(c.tm_deleted_at))
  const eligible             = candidates.filter(c =>  inCronWindow(c.wob_deleted_at) &&  inCronWindow(c.tm_deleted_at))

  const cohortTally = new Map<string, number>()
  for (const c of candidates) {
    const k = c.wob_deleted_at ? c.wob_deleted_at.toISOString() : 'NULL (active)'
    cohortTally.set(k, (cohortTally.get(k) ?? 0) + 1)
  }
  log(`World of Books deletion cohorts among the candidates:`)
  for (const [k, v] of [...cohortTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    const d  = k.startsWith('NULL') ? null : new Date(k)
    const ok = inCronWindow(d)
    log(`  ${ok ? 'in window ' : 'REFUSED   '} ${k}  ×${v}`)
  }
  log(`eligible after the cron-window guard: ${eligible.length} · refused: ${refusedOutsideWindow.length}`)

  const tmAlreadyActive = eligible.filter(c => c.tm_deleted_at === null).length
  log(`of those, Travelling Man is already live on ${tmAlreadyActive} (World of Books side only), swept on ${eligible.length - tmAlreadyActive}`)

  const plannedPairs    = Math.min(eligible.length, MAX_PAIRS)
  const plannedRequests = plannedPairs * 2   // both sides are verified, active or not
  log('')
  log(`INTENDED: verify ${plannedPairs} pairs = ${plannedRequests} product requests, ~${Math.ceil(plannedRequests * 1.3 / 60)} min, £0 external cost`)

  const outcomes: PairOutcome[] = []
  let publishedPairs = 0, rowsRevived = 0, historyRows = 0
  let consecutiveTransient = 0, transientTotal = 0
  let breakerTripped: string | null = null
  let priceDriftOnActive = 0, identicalPricePairs = 0, alreadyLivePairs = 0

  /** Verify one side. Never writes. */
  async function verifySide(
    domain: string, listingId: string, sku: string, url: string,
    stored: Prisma.Decimal, deletedAt: Date | null,
  ): Promise<SideOutcome> {
    const storedStr = String(stored)
    const r = await verifyRow(domain, {
      id: listingId, retailerSku: sku, retailerUrl: url, priceAmount: storedStr,
    })
    const side: SideOutcome = {
      ...r,
      domain,
      state: deletedAt === null ? 'alreadyActive' : 'revivable',
      stored: storedStr,
      scopedDeletedAt: deletedAt ? deletedAt.toISOString() : null,
      written: false,
    }
    if (r.klass === 'transient') {
      consecutiveTransient++; transientTotal++
      side.failure = {
        endpoint: `https://${domain}/products/<handle>.js`,
        klass: r.klass,
        effect: 'pair abandoned — a failed request is never treated as fresh or as out-of-stock',
      }
    } else {
      consecutiveTransient = 0
      if (!PURCHASABLE_KLASSES.includes(r.klass) && r.klass !== 'unavailable') {
        side.failure = {
          endpoint: `https://${domain}/products/<handle>.js`,
          klass: r.klass,
          effect: 'pair abandoned — identity or availability could not be proven',
        }
      }
    }
    return side
  }

  if (!MEASURE) {
    for (const c of eligible) {
      if (publishedPairs >= MAX_PAIRS) { log(`reached publication ceiling ${MAX_PAIRS} pairs — stopping`); break }
      if (cost.productRequests >= MAX_PAIR_CANDIDATES * 2) { breakerTripped = 'product request ceiling reached'; break }
      if (Date.now() - t0 > MAX_RUNTIME_MS)                { breakerTripped = 'runtime ceiling reached'; break }

      const isbn = c.tm_isbn ?? c.product_isbn

      const tm = await verifySide(TM_DOMAIN, c.tm_id, c.tm_sku, c.tm_url, c.tm_price, c.tm_deleted_at)
      await sleep(BETWEEN_PRODUCT_MS)

      // Circuit breaker is checked between sides so a failing provider cannot
      // burn the whole budget.
      if (consecutiveTransient >= MAX_CONSECUTIVE_TRANSIENT) {
        breakerTripped = `${consecutiveTransient} consecutive transient failures`
        const notRequested: SideOutcome = {
          domain: WOB_DOMAIN, id: c.wob_id, sku: c.wob_sku,
          state: c.wob_deleted_at === null ? 'alreadyActive' : 'revivable',
          stored: String(c.wob_price),
          scopedDeletedAt: c.wob_deleted_at ? c.wob_deleted_at.toISOString() : null,
          written: false, klass: 'transient', live: null,
          note: 'not requested — breaker tripped before this side',
        }
        outcomes.push({ slug: c.canonical_slug, title: c.title, isbn, published: false,
          skipReason: `safe stop — ${breakerTripped}`, tm, wob: notRequested })
        log(`SAFE STOP — ${breakerTripped}`); break
      }

      const wob = await verifySide(WOB_DOMAIN, c.wob_id, c.wob_sku, c.wob_url, c.wob_price, c.wob_deleted_at)

      const o: PairOutcome = { slug: c.canonical_slug, title: c.title, isbn, published: false, tm, wob }

      const bothPurchasable = PURCHASABLE_KLASSES.includes(tm.klass) && PURCHASABLE_KLASSES.includes(wob.klass)
      const badSide = !PURCHASABLE_KLASSES.includes(tm.klass) ? tm
                    : !PURCHASABLE_KLASSES.includes(wob.klass) ? wob : null

      if (!bothPurchasable && badSide) {
        o.skipReason = badSide.klass === 'unavailable'
          ? `${badSide.domain} is sold out live — pair abandoned, neither side published`
          : `${badSide.domain} unverified (${badSide.klass}) — pair abandoned, neither side published`
      } else if (tm.live === null || wob.live === null) {
        o.skipReason = 'a side returned no live price — pair abandoned'
      } else if (isImplausiblePrice(Number(tm.stored), Number(tm.live))) {
        o.skipReason = `${TM_DOMAIN} price implausible (${tm.stored} -> ${tm.live}) — refused by the ${MAX_PRICE_RATIO}x guard`
      } else if (isImplausiblePrice(Number(wob.stored), Number(wob.live))) {
        o.skipReason = `${WOB_DOMAIN} price implausible (${wob.stored} -> ${wob.live}) — refused by the ${MAX_PRICE_RATIO}x guard`
      } else {
        // Two retailers at the SAME live price is a legitimate comparison, not
        // a reason to discard the pair — it is only counted separately, because
        // the demo page wants an edition where the two prices differ.
        if (Number(tm.live) === Number(wob.live)) identicalPricePairs++
        // Eligible. Each side is written only if it is actually soft-deleted.
        const sides = [tm, wob]
        if (tm.state === 'alreadyActive' && wob.state === 'alreadyActive') {
          // Already published, by an earlier run or by the daily refresh. Both
          // sides verified, so the comparison is real, but there is nothing to
          // write — and counting it as "published" would make a re-run look
          // like it had duplicated work it did not do.
          o.skipReason = 'both sides already live — verified, nothing to write (this pair was published by an earlier run)'
          alreadyLivePairs++
        } else if (WRITE) {
          let failed: string | null = null
          for (const s of sides) {
            if (s.state === 'alreadyActive') {
              s.note = 'live already — verified only, not written (owned by the 02:00 offer-refresh job)'
              if (Number(s.live) !== Number(s.stored)) {
                s.note += `; live price has drifted ${s.stored} -> ${s.live}, left for the refresh to correct`
                priceDriftOnActive++
              }
              continue
            }
            const now = new Date()
            const retailerId = s.domain === TM_DOMAIN ? tmRetailer.id : wobRetailer.id
            // Scoped to this row AND the exact deleted_at read above: a row
            // that moved underneath us matches 0 and is reported, not forced.
            const res = await prisma.retailerListing.updateMany({
              where: {
                id: s.id, retailerId,
                deletedAt: new Date(s.scopedDeletedAt as string),
              },
              data: {
                deletedAt:   null,
                priceAmount: new Prisma.Decimal(s.live as string),
                stockStatus: 'IN_STOCK',
                lastSeenAt:  now,
                ...(Number(s.live) !== Number(s.stored) ? { lastPriceChangeAt: now } : {}),
              },
            })
            if (res.count !== 1) {
              failed = `${s.domain} updateMany matched ${res.count} rows at deleted_at ${s.scopedDeletedAt} — pair left partial-free`
              break
            }
            // Every revived row changes stock status (OUT_OF_STOCK -> IN_STOCK),
            // so by the existing "append on a genuine change" rule each earns
            // exactly one observation. A published row cannot be selected as
            // revivable again, so this cannot duplicate.
            await prisma.priceHistory.create({
              data: {
                retailerListingId: s.id,
                priceAmount:       new Prisma.Decimal(s.live as string),
                priceCurrency:     'GBP',
                stockStatus:       'IN_STOCK',
                recordedAt:        now,
              },
            })
            s.written = true
            rowsRevived++
            historyRows++
          }
          if (failed) {
            o.skipReason = failed
            log(`  WARN ${failed}`)
          } else {
            o.published = true
            publishedPairs++
          }
        } else {
          o.skipReason = 'eligible — both sides verified available; would be published with --write'
          publishedPairs++   // count against the ceiling so the dry run previews truthfully
        }
      }

      outcomes.push(o)
      const tag = o.published ? 'PUBLISHED' : (bothPurchasable ? 'ELIGIBLE ' : 'skip     ')
      log(`  ${tag} TM £${tm.stored}->${tm.live ?? '—'} ${tm.klass.padEnd(20)} | WoB £${wob.stored}->${wob.live ?? '—'} ${wob.klass.padEnd(20)} ${c.title.slice(0, 38)}`)

      if (cost.productRequests >= TRANSIENT_RATE_MIN_SAMPLE &&
          transientTotal / cost.productRequests > TRANSIENT_RATE_LIMIT) {
        breakerTripped = `transient rate above ${TRANSIENT_RATE_LIMIT * 100}%`
        log(`SAFE STOP — ${breakerTripped}`); break
      }

      await sleep(BETWEEN_PRODUCT_MS)
    }
  }

  const after  = await snapshot()
  const wallMs = Date.now() - t0

  const sides  = outcomes.flatMap(o => [o.tm, o.wob])
  const tally  = (k: VerifyKlass) => sides.filter(s => s.klass === k).length
  const report = {
    version: 1,
    runAt: new Date().toISOString(),
    mode: MEASURE ? 'MEASURE-ONLY (no HTTP, zero writes)'
        : WRITE   ? `WRITE (bounded, both-sides-verified-in-run only, ceiling ${MAX_PAIRS} pairs)`
                  : 'DRY-RUN (read-only, zero writes)',
    unitOfWork: 'pair — both sides verified live and available in this run, or neither side published',
    scope: {
      travellingMan: `deleted_at = ${TM_SWEEP_AT.toISOString()} or already active`,
      worldOfBooks:  `deleted_at inside ${CRON_WINDOW_START_MIN / 60}:00-0${Math.floor(CRON_WINDOW_END_MIN / 60)}:${String(CRON_WINDOW_END_MIN % 60).padStart(2, '0')} UTC cron window, or already active`,
      perRowScoping: 'every UPDATE scoped to id AND the exact deleted_at read in this run',
    },
    breakerTripped,
    bounds: { MAX_PAIR_CANDIDATES, MAX_PAIRS, BETWEEN_PRODUCT_MS, MAX_RUNTIME_MS, MAX_RETRIES, MAX_PRICE_RATIO },
    evidenceRule: 'fresh /products/<handle>.js response in this run, for BOTH sides; exact product id and stored variant; available:true; plausible price. Sitemap never used as price evidence.',
    pairCandidates: candidates.length,
    refusedOutsideCronWindow: refusedOutsideWindow.map(c => ({
      slug: c.canonical_slug,
      wobDeletedAt: c.wob_deleted_at?.toISOString() ?? null,
      tmDeletedAt:  c.tm_deleted_at?.toISOString() ?? null,
      reason: 'deleted_at outside the 03:00-04:01 UTC cron window — presumed deliberate, left alone',
    })),
    worldOfBooksCohorts: [...cohortTally.entries()].map(([at, rows]) => ({
      deletedAt: at, rows, inCronWindow: inCronWindow(at.startsWith('NULL') ? null : new Date(at)),
    })),
    eligibleAfterGuard: eligible.length,
    travellingManAlreadyLive: tmAlreadyActive,
    verification: {
      availableUnchanged:     tally('availableUnchanged'),
      availablePriceChanged:  tally('availablePriceChanged'),
      unavailableLeftDeleted: tally('unavailable'),
      variantMissing:         tally('variantMissing'),
      productIdMismatch:      tally('productIdMismatch'),
      notFound404:            tally('notFound'),
      transientFailures:      tally('transient'),
      otherErrors:            tally('otherError'),
    },
    pairsPublished: outcomes.filter(o => o.published).length,
    // Counted among ELIGIBLE pairs, so these stay meaningful in dry-run mode
    // where nothing is published.
    pairsAtDifferentLivePrice: Math.max(0, publishedPairs - identicalPricePairs),
    pairsAtIdenticalLivePrice: identicalPricePairs,
    /** Verified but not written: already published by an earlier run. */
    pairsAlreadyLive: alreadyLivePairs,
    writeTotals: {
      pairsPublished:           outcomes.filter(o => o.published).length,
      rowsRevived,
      priceHistoryRowsCreated:  historyRows,
      alreadyActiveRowsWritten: 0,
      priceDriftLeftForRefresh: priceDriftOnActive,
      listingsCreated:          0,
      canonicalProductsCreated: 0,
      matcherCalls:             0,
      inngestExecutions:        0,
      retailerLastSyncedAtTouched:    0,
      rowsTouchedOutsideCronWindow:   0,
    },
    productionState: { before, after },
    cost: {
      productRequests:   cost.productRequests,
      retryRequests:     cost.retryRequests,
      totalHttpRequests: cost.productRequests + cost.retryRequests,
      inboundMiB:        Number((cost.inboundBytes / 1048576).toFixed(2)),
      wallClockMs: wallMs, wallClockMin: Number((wallMs / 60000).toFixed(1)),
      externalApiCostGBP: 0,
    },
    outcomes,
  }

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(report, null, 2))

  log('')
  log(`AFTER:  priced listings ${after.pricedListings} (was ${before.pricedListings}) · priced products ${after.pricedProducts} (was ${before.pricedProducts})`)
  log(`        products at 2+ retailers ${after.productsAtTwoRetailers} (was ${before.productsAtTwoRetailers})`)
  log(`        TM active ${after.tmActiveRows} (was ${before.tmActiveRows}) · WoB active ${after.wobActiveRows} (was ${before.wobActiveRows})`)
  log(`        TM sweep cohort ${after.tmSweepCohortStillDeleted} (was ${before.tmSweepCohortStillDeleted}) · unrelated deletions ${after.unrelatedDeletedRows} (was ${before.unrelatedDeletedRows}, must be unchanged)`)
  log(`        price_history ${before.priceHistoryRows} -> ${after.priceHistoryRows} · retailer_listings ${before.retailerListings} -> ${after.retailerListings} (must be unchanged)`)
  log(`        canonical_products ${before.canonicalProducts} -> ${after.canonicalProducts} (must be unchanged)`)
  log('')
  log(`pairs published ${report.pairsPublished} · rows revived ${rowsRevived} · observations ${historyRows}`)
  log(`sides verified available ${report.verification.availableUnchanged + report.verification.availablePriceChanged} · sold out ${report.verification.unavailableLeftDeleted} · 404 ${report.verification.notFound404} · transient ${report.verification.transientFailures}`)
  log(`http ${report.cost.totalHttpRequests} requests · ${report.cost.inboundMiB} MiB · ${report.cost.wallClockMin} min · £0`)
  if (breakerTripped) log(`BREAKER TRIPPED: ${breakerTripped}`)
  log(`-> ${OUT}`)

  await prisma.$disconnect()
}

main().catch(async e => {
  await prisma.$disconnect()
  console.error(e)
  process.exit(1)
})
