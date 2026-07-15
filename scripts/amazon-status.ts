#!/usr/bin/env tsx
/**
 * amazon-status.ts — READ-ONLY Amazon coverage report (post-Rainforest).
 *
 * Rainforest was retired on 2026-07-13 (account closed). Amazon posture is
 * AFFILIATE-ONLY / STORED OFFERS: stored listings display while fresh, are
 * suppressed past 30 days, and are never refreshed. This report shows what
 * remains, what is about to expire, and what a future compliant integration
 * (Amazon Creators API) would be reintroduced for.
 *
 * Usage:  npm run amazon:status
 *
 * STRICTLY READ-ONLY. No external API calls. No writes. Safe to run any time.
 */

import { prisma }           from '../lib/prisma'
import { wrapAffiliateUrl } from '../lib/affiliate'

const n = (v: unknown) => Number(v ?? 0)
type Row = Record<string, unknown>

async function main() {
  console.log('\n══════════════════════════════════════════════════════════')
  console.log(' Amazon UK — status report (READ-ONLY)')
  console.log(' Mode: AFFILIATE-ONLY / STORED OFFERS · no live refresh source')
  console.log(' Rainforest: RETIRED 2026-07-13 · see amazon-post-rainforest-plan.md')
  console.log('══════════════════════════════════════════════════════════\n')

  const amazon = await prisma.retailer.findUnique({
    where: { domain: 'amazon.co.uk' },
    select: { id: true, name: true, isActive: true, trustScore: true, affiliateNetwork: true, affiliateId: true },
  })
  if (!amazon) {
    console.log('  No amazon.co.uk retailer record exists. Nothing to report.')
    return
  }
  console.log(`  Retailer     : ${amazon.name} (active: ${amazon.isActive}, trust: ${amazon.trustScore})`)
  console.log(`  Affiliate    : network=${amazon.affiliateNetwork ?? 'none'} tag=${amazon.affiliateId ?? 'NONE ⚠'}`)

  // Affiliate-link health: wrap a real stored listing URL through /go's code path.
  const sampleListing = await prisma.retailerListing.findFirst({
    where : { retailerId: amazon.id, deletedAt: null, priceAmount: { gt: 0 } },
    select: { retailerUrl: true },
    orderBy: { lastSeenAt: 'desc' },
  })
  if (sampleListing && amazon.affiliateNetwork && amazon.affiliateId) {
    const wrapped = wrapAffiliateUrl(sampleListing.retailerUrl, amazon.affiliateNetwork, amazon.affiliateId)
    const tagged  = wrapped.includes(`tag=${amazon.affiliateId}`)
    console.log(`  /go wrapping : ${tagged ? '✓ carries' : '✗ MISSING'} tag=${amazon.affiliateId} on stored listing URLs`)
  }
  console.log('')

  // ── Stored listing state ────────────────────────────────────────────────────
  const [ls] = await prisma.$queryRaw<Row[]>`
    SELECT COUNT(*)                                              AS total_rows,
      COUNT(*) FILTER (WHERE deleted_at IS NULL)                 AS live_rows,
      COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)             AS soft_deleted,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND price_amount > 0)  AS priced,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND price_amount > 0
        AND last_seen_at >  NOW() - INTERVAL '30 days')          AS visible,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND price_amount > 0
        AND last_seen_at <= NOW() - INTERVAL '30 days')          AS suppressed,
      COUNT(*) FILTER (WHERE deleted_at IS NULL AND retailer_sku IS NOT NULL) AS with_asin,
      MIN(last_seen_at) FILTER (WHERE deleted_at IS NULL AND price_amount > 0)::date::text AS oldest,
      MAX(last_seen_at) FILTER (WHERE deleted_at IS NULL AND price_amount > 0)::date::text AS newest
    FROM retailer_listings WHERE retailer_id = ${amazon.id}::uuid`
  console.log('  ── Stored listings ──')
  console.log(`  Rows         : ${n(ls.total_rows)} total · ${n(ls.live_rows)} live · ${n(ls.soft_deleted)} soft-deleted (historical)`)
  console.log(`  Priced live  : ${n(ls.priced)} → visible: ${n(ls.visible)} · suppressed (>30d): ${n(ls.suppressed)}`)
  console.log(`  ASIN coverage: ${n(ls.with_asin)} of ${n(ls.live_rows)} live rows carry an ASIN`)
  console.log(`  Observations : ${ls.oldest ?? 'n/a'} → ${ls.newest ?? 'n/a'} (never updated again — no refresh source)\n`)

  // ── Coverage-loss forecast ──────────────────────────────────────────────────
  const forecast = await prisma.$queryRaw<Row[]>`
    SELECT (last_seen_at + INTERVAL '30 days')::date::text AS hidden_on, COUNT(*) AS rows
    FROM retailer_listings
    WHERE retailer_id = ${amazon.id}::uuid AND deleted_at IS NULL AND price_amount > 0
      AND last_seen_at > NOW() - INTERVAL '30 days'
    GROUP BY 1 ORDER BY 1`
  console.log('  ── Coverage-loss forecast (visible rows expire on) ──')
  if (forecast.length === 0) console.log('  (no visible rows remain — coverage fully aged out)')
  for (const f of forecast) console.log(`  ${f.hidden_on}  ${String(n(f.rows)).padStart(5)} rows`)
  console.log('  Expiry is INTENTIONAL and honest — do not fake freshness.\n')

  // ── What Amazon still contributes ───────────────────────────────────────────
  const [depth] = await prisma.$queryRaw<Row[]>`
    WITH priced AS (
      SELECT l.canonical_product_id AS pid, l.retailer_id
      FROM retailer_listings l JOIN retailers r ON r.id = l.retailer_id
      WHERE l.deleted_at IS NULL AND l.price_amount > 0 AND r.is_active
        AND l.last_seen_at > NOW() - INTERVAL '30 days'
        AND l.canonical_product_id IS NOT NULL
    ), per_product AS (
      SELECT pid, COUNT(DISTINCT retailer_id) AS retailers,
        BOOL_OR(retailer_id = ${amazon.id}::uuid) AS has_amazon
      FROM priced GROUP BY pid
    )
    SELECT
      COUNT(*) FILTER (WHERE retailers >= 2 AND has_amazon)  AS comparisons_with_amazon,
      COUNT(*) FILTER (WHERE has_amazon AND retailers = 1)   AS amazon_only_price
    FROM per_product`
  const [clicks] = await prisma.$queryRaw<Row[]>`
    SELECT COUNT(*) AS all_time,
      COUNT(*) FILTER (WHERE ce.clicked_at > NOW() - INTERVAL '30 days') AS last_30d
    FROM click_events ce JOIN retailer_listings l ON l.id = ce.listing_id
    WHERE l.retailer_id = ${amazon.id}::uuid`
  console.log('  ── Current contribution (fresh offers only) ──')
  console.log(`  Price comparisons including Amazon : ${n(depth.comparisons_with_amazon)}`)
  console.log(`  Products where Amazon is only price: ${n(depth.amazon_only_price)}`)
  console.log(`  /go clicks on Amazon offers        : ${n(clicks.all_time)} all time · ${n(clicks.last_30d)} in 30d\n`)

  // ── Future-coverage candidates (for a compliant integration later) ─────────
  const [future] = await prisma.$queryRaw<Row[]>`
    SELECT COUNT(DISTINCT cp.id) AS comic_isbns
    FROM canonical_products cp
    WHERE cp.deleted_at IS NULL AND cp.isbn_13 IS NOT NULL
      AND (cp.format::text <> 'OTHER' OR cp.comicvine_id IS NOT NULL)`
  console.log('  ── Future coverage pool (when a compliant source is approved) ──')
  console.log(`  Comic-shaped canonicals with ISBN-13: ${n(future.comic_isbns)}`)
  console.log('  Preferred route: Amazon Creators API (needs 10 qualifying sales/30d).\n')

  // ── Historical note ─────────────────────────────────────────────────────────
  const [hist] = await prisma.$queryRaw<Row[]>`
    SELECT COUNT(*) AS calls, MAX(called_at)::date::text AS last_call
    FROM api_usage_log WHERE provider = 'rainforest'`
  console.log('  ── Historical (retired provider) ──')
  console.log(`  api_usage_log rainforest rows: ${n(hist.calls)} (last: ${hist.last_call ?? 'never'}) — historical audit only; no new rows can be written.`)
  console.log('\n══════════════════════════════════════════════════════════\n')
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
