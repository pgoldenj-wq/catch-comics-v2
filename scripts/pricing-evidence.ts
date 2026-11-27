/**
 * pricing-evidence.ts — READ-ONLY per-retailer proof of price freshness.
 *
 * Answers, per retailer and without writing anything:
 *   - how many priced rows it has, and whether they reconcile to the total
 *   - the actual earliest expiry (oldest last_seen_at + the 30-day sweep)
 *   - the last sync attempt AND the last genuinely successful one
 *   - stock composition, because a swept row reads OUT_OF_STOCK and would
 *     otherwise be counted as a "live offer"
 *   - one public product URL per retailer, so a claim can be opened and checked
 *
 * STRICTLY READ-ONLY: no writes, no syncs, no paid APIs.
 * Run: npm run pricing:evidence
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const SWEEP_DAYS = 30
const SITE = 'https://www.catchcomics.com'

const iso = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 16).replace('T', ' ') : '—'
const n = (v: unknown) => Number(v ?? 0)

async function main() {
  const now = Date.now()

  // ── 1. Per-retailer accounting ────────────────────────────────────────────
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT r.domain,
           r.platform::text AS platform,
           r.last_synced_at AS "lastSyncedAt",
           COALESCE((r.sync_config->'scheduled_sync_disabled') = 'true'::jsonb, false) AS disabled,
           CASE WHEN jsonb_typeof(r.sync_config->'refreshIntervalHours') = 'number'
                THEN (r.sync_config->>'refreshIntervalHours')::int END AS "intervalHours",
           COUNT(rl.id)::int AS priced,
           COUNT(DISTINCT rl.canonical_product_id)::int AS products,
           MIN(rl.last_seen_at) AS oldest,
           MAX(rl.last_seen_at) AS newest,
           COUNT(*) FILTER (WHERE rl.stock_status::text = 'IN_STOCK')::int   AS "inStock",
           COUNT(*) FILTER (WHERE rl.stock_status::text = 'OUT_OF_STOCK')::int AS "outOfStock",
           COUNT(*) FILTER (WHERE rl.stock_status::text NOT IN ('IN_STOCK','OUT_OF_STOCK'))::int AS "otherStock"
    FROM retailers r
    LEFT JOIN retailer_listings rl
      ON rl.retailer_id = r.id AND rl.deleted_at IS NULL AND rl.price_amount > 0
    WHERE r.is_active = true
    GROUP BY r.id, r.domain, r.platform, r.last_synced_at, r.sync_config
    ORDER BY COUNT(rl.id) DESC, r.domain
  `

  console.log('\n## 1. Priced rows and the actual earliest expiry, per retailer\n')
  console.log('   retailer              platform        intvl  sched  priced  in/oos/oth   oldest last_seen  EARLIEST EXPIRY    left')
  let total = 0
  for (const r of rows) {
    total += n(r.priced)
    const oldest = r.oldest as Date | null
    const expiry = oldest ? new Date(oldest.getTime() + SWEEP_DAYS * 864e5) : null
    const left = expiry ? ((expiry.getTime() - now) / 864e5).toFixed(1) + 'd' : '—'
    const stock = `${n(r.inStock)}/${n(r.outOfStock)}/${n(r.otherStock)}`
    // Deliberate exclusions must be visible: a retailer reading OFF here is
    // excluded on purpose (gated CLI only), not broken.
    const intvl = r.intervalHours === null || r.intervalHours === undefined
      ? 'dflt' : `${n(r.intervalHours)}h`
    const sched = r.disabled === true ? 'OFF' : 'on'
    console.log(
      '   ' + String(r.domain).padEnd(21) +
      String(r.platform).padEnd(16) +
      intvl.padEnd(7) +
      sched.padEnd(7) +
      String(n(r.priced)).padStart(6) + '  ' +
      stock.padEnd(13) +
      iso(oldest).padEnd(18) +
      iso(expiry).padEnd(19) + left,
    )
  }
  console.log(`\n   TOTAL priced rows: ${total}`)

  // ── 2. Last attempt vs last SUCCESS ───────────────────────────────────────
  const attempts = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT DISTINCT ON (s.retailer_id)
           r.domain, s.status, s.started_at AS "startedAt", s.finished_at AS "finishedAt",
           s.products_fetched AS "fetched", s.listings_created AS "created",
           s.listings_updated AS "updated", s.price_changes AS "priceChanges"
    FROM sync_logs s JOIN retailers r ON r.id = s.retailer_id
    ORDER BY s.retailer_id, s.started_at DESC
  `
  const successes = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT DISTINCT ON (s.retailer_id)
           r.domain, s.started_at AS "startedAt", s.finished_at AS "finishedAt",
           s.products_fetched AS "fetched", s.listings_updated AS "updated",
           s.price_changes AS "priceChanges"
    FROM sync_logs s JOIN retailers r ON r.id = s.retailer_id
    WHERE s.status = 'success'
    ORDER BY s.retailer_id, s.started_at DESC
  `
  const sucByDomain = new Map(successes.map(s => [String(s.domain), s]))

  console.log('\n## 2. Last sync attempt, and the last one that actually succeeded\n')
  console.log('   retailer              last attempt     status   | LAST SUCCESS      fetched  updated  priceChg')
  for (const a of attempts) {
    const s = sucByDomain.get(String(a.domain))
    console.log(
      '   ' + String(a.domain).padEnd(21) +
      iso(a.startedAt as Date).padEnd(17) +
      String(a.status).padEnd(9) + '| ' +
      (s ? iso(s.startedAt as Date).padEnd(18) +
           String(n(s.fetched)).padStart(7) +
           String(n(s.updated)).padStart(9) +
           String(n(s.priceChanges)).padStart(9)
         : 'NEVER SUCCEEDED'),
    )
  }
  const silent = rows.filter(r => !attempts.some(a => a.domain === r.domain))
  if (silent.length) {
    console.log('\n   no sync_logs row at all: ' + silent.map(r => r.domain).join(', '))
  }

  // ── 3. One public product URL per retailer ────────────────────────────────
  const samples = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT DISTINCT ON (rl.retailer_id)
           r.domain, cp.canonical_slug AS slug, cp.title,
           rl.price_amount AS price, rl.price_currency AS currency,
           rl.stock_status::text AS stock, rl.last_seen_at AS "lastSeen"
    FROM retailer_listings rl
    JOIN retailers r           ON r.id  = rl.retailer_id
    JOIN canonical_products cp ON cp.id = rl.canonical_product_id
    WHERE rl.deleted_at IS NULL AND rl.price_amount > 0
    ORDER BY rl.retailer_id, rl.last_seen_at DESC
  `
  console.log('\n## 3. One public product URL per retailer (open these to check a claim)\n')
  for (const s of samples) {
    console.log(`   ${String(s.domain).padEnd(21)} ${String(s.currency)}${n(s.price).toFixed(2).padStart(8)}  ${String(s.stock).padEnd(13)} seen ${iso(s.lastSeen as Date)}`)
    console.log(`      ${String(s.title).slice(0, 86)}`)
    console.log(`      ${SITE}/product/${s.slug}\n`)
  }

  // ── 4. Multi-retailer coverage — the actual comparison promise ────────────
  const [cov] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      COUNT(*) FILTER (WHERE c = 1)::int  AS one,
      COUNT(*) FILTER (WHERE c >= 2)::int AS two_plus,
      COUNT(*)::int                       AS any_priced
    FROM (
      SELECT rl.canonical_product_id, COUNT(DISTINCT rl.retailer_id) AS c
      FROM retailer_listings rl
      WHERE rl.deleted_at IS NULL AND rl.price_amount > 0
        AND rl.canonical_product_id IS NOT NULL
      GROUP BY rl.canonical_product_id
    ) t
  `
  console.log('## 4. Price-comparison coverage\n')
  console.log(`   products with any priced offer : ${n(cov.any_priced)}`)
  console.log(`   ...priced at exactly 1 retailer: ${n(cov.one)}`)
  console.log(`   ...priced at 2+ retailers      : ${n(cov.two_plus)}  <- the comparison promise`)

  await prisma.$disconnect()
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
