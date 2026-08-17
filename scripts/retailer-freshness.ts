/**
 * retailer-freshness.ts — how much genuine price comparison do we actually have,
 * and how long before it disappears?
 *
 * Written during the 2026-08-18 audit, which found that the honest answer to
 * "how many products can a customer really compare?" was: essentially none.
 * 48,631 priced products had exactly one retailer; ONE product in the whole
 * catalogue had two or more non-eBay retailers.
 *
 * It also found a fuse. Nothing has refreshed since 2026-08-09 because the
 * retailer syncs are deliberately disabled (correctly — they caused the Inngest
 * execution incident). cleanup-stale soft-deletes anything unseen for 30 days,
 * so today's visible prices expire on a rolling basis and the shelf empties.
 * That is invisible in any single-day snapshot, which is why this measures the
 * expiry curve rather than just a total.
 *
 * Read-only: aggregates only, no row dumps, no writes, no external APIs.
 * Run: npm run retailer:freshness
 */

import { PrismaClient } from '@prisma/client'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const OUT = join(process.cwd(), 'launch', 'operations', 'retailer-freshness-latest.json')
const STALE_AFTER_DAYS = 30   // cleanup-stale's soft-delete window

const prisma = new PrismaClient()
const num = (v: unknown) => (typeof v === 'bigint' ? Number(v) : v)

async function main() {
  const [depth] = await prisma.$queryRawUnsafe<any[]>(`
    WITH visible AS (
      SELECT l.canonical_product_id AS cid, r.name AS retailer
      FROM retailer_listings l JOIN retailers r ON r.id = l.retailer_id
      WHERE l.deleted_at IS NULL AND l.price_amount > 0 AND l.canonical_product_id IS NOT NULL
    ), per AS (
      SELECT cid,
        COUNT(*) FILTER (WHERE retailer ILIKE '%ebay%')                     AS ebay_n,
        COUNT(DISTINCT retailer) FILTER (WHERE retailer NOT ILIKE '%ebay%') AS other_distinct
      FROM visible GROUP BY cid
    )
    SELECT
      (SELECT COUNT(*) FROM canonical_products)             AS catalogue_total,
      (SELECT COUNT(*) FROM per)                            AS priced_products,
      COUNT(*) FILTER (WHERE ebay_n>0 AND other_distinct=0) AS stored_ebay_only,
      COUNT(*) FILTER (WHERE other_distinct=1)              AS exactly_one_retailer,
      COUNT(*) FILTER (WHERE other_distinct>=2)             AS two_plus_retailers,
      COUNT(*) FILTER (WHERE other_distinct>=3)             AS three_plus_retailers
    FROM per;
  `)

  // Aggregate listings by retailer_id FIRST, then join the (tiny) retailers
  // table. Grouping the 800k-row join by a jsonb sync_config column instead
  // made this query run for over ten minutes against Neon.
  const retailers = await prisma.$queryRawUnsafe<any[]>(`
    WITH agg AS (
      SELECT retailer_id,
        COUNT(*)                                                                 AS stored_rows,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND price_amount>0)             AS visible_priced,
        COUNT(*) FILTER (WHERE deleted_at IS NULL AND COALESCE(price_amount,0)=0) AS zero_price_stubs,
        MAX(last_seen_at)                                                        AS last_seen
      FROM retailer_listings GROUP BY retailer_id
    )
    SELECT r.name,
      COALESCE(r.sync_config->>'scheduled_sync_disabled','false') AS sync_disabled,
      COALESCE(a.stored_rows,0)      AS stored_rows,
      COALESCE(a.visible_priced,0)   AS visible_priced,
      COALESCE(a.zero_price_stubs,0) AS zero_price_stubs,
      a.last_seen
    FROM retailers r LEFT JOIN agg a ON a.retailer_id = r.id
    ORDER BY visible_priced DESC NULLS LAST;
  `)

  // The fuse: when today's visible prices cross the 30-day line and vanish.
  const expiry = await prisma.$queryRawUnsafe<any[]>(`
    SELECT (last_seen_at + INTERVAL '${STALE_AFTER_DAYS} days')::date AS expires_on,
           COUNT(*) AS rows_expiring
    FROM retailer_listings
    WHERE deleted_at IS NULL AND price_amount > 0
    GROUP BY expires_on ORDER BY expires_on;
  `)

  const [currency] = await prisma.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*) AS total,
           COUNT(*) FILTER (WHERE price_currency <> 'GBP') AS non_gbp
    FROM retailer_listings WHERE deleted_at IS NULL AND price_amount > 0;
  `)

  const totalVisible = Number(num(depth.priced_products))
  const firstExpiry = expiry[0]
  const lastExpiry = expiry[expiry.length - 1]

  // Postgres `::date` arrives as a JS Date, so String(d).slice(0,10) yields
  // "Mon Aug 17" — which is not parseable and made the dashboard compute a
  // negative countdown and claim prices had already expired. Always emit ISO.
  const isoDate = (d: unknown): string | null => {
    if (!d) return null
    const parsed = d instanceof Date ? d : new Date(String(d))
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
  }

  const out = {
    version: 1,
    runAt: new Date().toISOString(),
    staleAfterDays: STALE_AFTER_DAYS,
    catalogueTotal: Number(num(depth.catalogue_total)),
    pricedProducts: totalVisible,
    comparisonDepth: {
      exactlyOneRetailer: Number(num(depth.exactly_one_retailer)),
      twoPlusRetailers:   Number(num(depth.two_plus_retailers)),
      threePlusRetailers: Number(num(depth.three_plus_retailers)),
      storedEbayOnly:     Number(num(depth.stored_ebay_only)),
    },
    // eBay is a live Browse API lookup, never stored, so it contributes 0 rows
    // here while still appearing on every product page. That gap is exactly why
    // the site can feel "eBay only" while the database says otherwise.
    ebayIsLiveOnly: true,
    currency: {
      visiblePriced: Number(num(currency.total)),
      nonGbp:        Number(num(currency.non_gbp)),
    },
    fuse: {
      firstExpiryDate: isoDate(firstExpiry?.expires_on),
      lastExpiryDate:  isoDate(lastExpiry?.expires_on),
      curve: expiry.map(e => ({ date: isoDate(e.expires_on), rows: Number(num(e.rows_expiring)) })),
    },
    retailers: retailers.map(r => ({
      name:           r.name,
      syncDisabled:   r.sync_disabled === 'true',
      storedRows:     Number(num(r.stored_rows)),
      visiblePriced:  Number(num(r.visible_priced)),
      zeroPriceStubs: Number(num(r.zero_price_stubs)),
      lastSeen:       r.last_seen ? new Date(r.last_seen).toISOString() : null,
    })),
  }

  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`)

  console.log(`Catalogue          : ${out.catalogueTotal.toLocaleString()}`)
  console.log(`Priced products    : ${out.pricedProducts.toLocaleString()}`)
  console.log(`  exactly 1 retailer : ${out.comparisonDepth.exactlyOneRetailer.toLocaleString()}`)
  console.log(`  2+ retailers       : ${out.comparisonDepth.twoPlusRetailers.toLocaleString()}   <- genuine comparison`)
  console.log(`  3+ retailers       : ${out.comparisonDepth.threePlusRetailers.toLocaleString()}`)
  console.log(`Non-GBP visible    : ${out.currency.nonGbp}`)
  console.log(`Prices expire      : ${out.fuse.firstExpiryDate} → ${out.fuse.lastExpiryDate}`)
  console.log(`\nRecorded → ${OUT}`)
}

main()
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
