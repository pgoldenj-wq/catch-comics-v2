/**
 * launch-health.ts — READ-ONLY data & trust health check (Wave 3C/3D).
 *
 * Builds on scripts/audit-launch-readiness-stats.ts (kept as the raw query
 * reference) and produces the founder-facing operational snapshot:
 *   launch/operations/launch-health-latest.json   (Mission Control input)
 *   launch/operations/launch-health-latest.md     (readable summary)
 *
 * Deltas are computed against the previous launch-health-latest.json when one
 * exists; otherwise the report states "No prior snapshot available." — deltas
 * are never invented.
 *
 * STRICTLY READ-ONLY: no writes, no syncs, no enrichment, no paid APIs.
 *
 * Run: npm run launch:health
 */

import { PrismaClient } from '@prisma/client'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const prisma = new PrismaClient()
const OUT_DIR = join(process.cwd(), 'launch', 'operations')
const JSON_PATH = join(OUT_DIR, 'launch-health-latest.json')
const MD_PATH   = join(OUT_DIR, 'launch-health-latest.md')

const AMAZON_STALE_DAYS = 30

type Row = Record<string, unknown>
const n = (v: unknown) => Number(v ?? 0)

async function main() {
  // ── Previous snapshot for honest deltas ───────────────────────────────────
  interface PrevSnapshot {
    generatedAt?: string
    catalogue?: { liveProducts?: number; coverR2?: number; cvMatched?: number }
    pricing?: { pricedListings?: number; stale30dPlus?: number; productsPriced?: number }
  }
  let previous: PrevSnapshot | null = null
  try { previous = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as PrevSnapshot } catch { /* first run */ }

  // ── Catalogue ──────────────────────────────────────────────────────────────
  const [cat] = await prisma.$queryRaw<Row[]>`
    SELECT COUNT(*)                                                              AS live,
      COUNT(*) FILTER (WHERE cover_image_url LIKE '%images.catchcomics.com%')    AS cover_r2,
      COUNT(*) FILTER (WHERE cover_image_url IS NULL)                            AS cover_none,
      COUNT(*) FILTER (WHERE format::text <> 'OTHER')                            AS format_known,
      COUNT(*) FILTER (WHERE comicvine_id IS NOT NULL)                           AS cv_matched,
      COUNT(*) FILTER (WHERE description IS NOT NULL AND length(description)>30) AS described,
      COUNT(*) FILTER (WHERE cv_metadata ? 'creators'
        AND jsonb_array_length(cv_metadata->'creators') > 0)                     AS with_creators,
      COUNT(*) FILTER (WHERE cv_metadata ? 'cv_match_suspect'
        AND cv_metadata->>'cv_match_suspect' NOT IN ('false','null'))            AS suspect
    FROM canonical_products WHERE deleted_at IS NULL`

  // ── Pricing / freshness ────────────────────────────────────────────────────
  const [price] = await prisma.$queryRaw<Row[]>`
    SELECT COUNT(*) AS priced_listings,
      COUNT(*) FILTER (WHERE l.last_seen_at >  NOW() - INTERVAL '7 days')  AS fresh_7d,
      COUNT(*) FILTER (WHERE l.last_seen_at <= NOW() - INTERVAL '7 days'
                         AND l.last_seen_at >  NOW() - INTERVAL '30 days') AS aged_7_30d,
      COUNT(*) FILTER (WHERE l.last_seen_at <= NOW() - INTERVAL '30 days') AS stale_30d,
      COUNT(*) FILTER (WHERE l.stock_status = 'IN_STOCK')                  AS in_stock,
      COUNT(*) FILTER (WHERE l.stock_status = 'OUT_OF_STOCK')              AS out_of_stock,
      COUNT(DISTINCT l.canonical_product_id)                               AS products_priced
    FROM retailer_listings l JOIN retailers r ON r.id = l.retailer_id
    WHERE l.deleted_at IS NULL AND l.price_amount > 0 AND r.is_active`

  const depth = await prisma.$queryRaw<Row[]>`
    SELECT retailers, COUNT(*) AS products FROM (
      SELECT l.canonical_product_id, COUNT(DISTINCT l.retailer_id) AS retailers
      FROM retailer_listings l JOIN retailers r ON r.id = l.retailer_id
      WHERE l.deleted_at IS NULL AND l.price_amount > 0 AND r.is_active
      GROUP BY l.canonical_product_id) t
    GROUP BY retailers ORDER BY retailers`

  const retailers = await prisma.$queryRaw<Row[]>`
    SELECT r.name, COUNT(l.id) AS listings,
      COUNT(l.id) FILTER (WHERE l.last_seen_at > NOW() - INTERVAL '30 days') AS fresh_30d,
      MAX(l.last_seen_at)::date::text AS last_seen
    FROM retailers r
    LEFT JOIN retailer_listings l ON l.retailer_id = r.id
      AND l.deleted_at IS NULL AND l.price_amount > 0
    WHERE r.is_active
    GROUP BY r.name HAVING COUNT(l.id) > 0 ORDER BY listings DESC`

  // ── Amazon staleness deadline (Wave 3D) ────────────────────────────────────
  const [amz] = await prisma.$queryRaw<Row[]>`
    SELECT COUNT(*) AS total,
      COUNT(*) FILTER (WHERE l.last_seen_at >  NOW() - INTERVAL '30 days') AS visible,
      COUNT(*) FILTER (WHERE l.last_seen_at <= NOW() - INTERVAL '30 days') AS suppressed,
      MIN(l.last_seen_at)::date::text AS oldest_seen,
      MAX(l.last_seen_at)::date::text AS newest_seen
    FROM retailer_listings l JOIN retailers r ON r.id = l.retailer_id
    WHERE r.name ILIKE '%amazon%' AND l.deleted_at IS NULL AND l.price_amount > 0`

  await prisma.$disconnect()

  const allStaleBy = amz.newest_seen
    ? new Date(new Date(String(amz.newest_seen)).getTime() + AMAZON_STALE_DAYS * 864e5).toISOString().slice(0, 10)
    : null

  const one = n(depth.find(d => n(d.retailers) === 1)?.products)
  const twoPlus = depth.filter(d => n(d.retailers) >= 2).reduce((s, d) => s + n(d.products), 0)

  const snapshot = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'read-only Postgres queries (scripts/launch-health.ts)',
    catalogue: {
      liveProducts: n(cat.live),
      coverR2: n(cat.cover_r2),
      coverNone: n(cat.cover_none),
      coverR2Pct: +(100 * n(cat.cover_r2) / n(cat.live)).toFixed(1),
      formatKnownPct: +(100 * n(cat.format_known) / n(cat.live)).toFixed(1),
      cvMatched: n(cat.cv_matched),
      cvMatchedPct: +(100 * n(cat.cv_matched) / n(cat.live)).toFixed(1),
      described: n(cat.described),
      withCreators: n(cat.with_creators),
      suspectFlagged: n(cat.suspect),
    },
    pricing: {
      pricedListings: n(price.priced_listings),
      fresh7d: n(price.fresh_7d),
      aged7to30d: n(price.aged_7_30d),
      stale30dPlus: n(price.stale_30d),
      stalePct: +(100 * n(price.stale_30d) / Math.max(1, n(price.priced_listings))).toFixed(2),
      inStock: n(price.in_stock),
      outOfStock: n(price.out_of_stock),
      productsPriced: n(price.products_priced),
      comparisonDepth: { oneRetailer: one, twoPlusRetailers: twoPlus },
      retailers: retailers.map(r => ({
        name: String(r.name), listings: n(r.listings), fresh30d: n(r.fresh_30d), lastSeen: r.last_seen ?? null,
      })),
    },
    amazon: {
      // Rainforest retired 2026-07-13 (account closed). No live refresh source.
      // Stored offers display while fresh and age out under the 30-day rule —
      // intentional and honest. Informational state, never a system failure.
      mode: 'AFFILIATE_ONLY_STORED_OFFERS',
      liveRefreshSource: null,
      staleThresholdDays: AMAZON_STALE_DAYS,
      total: n(amz.total),
      visibleOnSite: n(amz.visible),
      suppressedAsStale: n(amz.suppressed),
      oldestSeen: amz.oldest_seen ?? null,
      newestSeen: amz.newest_seen ?? null,
      allVisibleRowsGoStaleBy: allStaleBy,
      note: 'No action required. Amazon data coverage will decline as stored listings expire. This is intentional and honest until a compliant replacement (Amazon Creators API when eligible) is approved. See launch/operations/amazon-post-rainforest-plan.md.',
    },
    previousSnapshotAt: previous?.generatedAt ?? null,
    deltas: previous ? {
      liveProducts: n(cat.live) - n(previous.catalogue?.liveProducts),
      coverR2: n(cat.cover_r2) - n(previous.catalogue?.coverR2),
      cvMatched: n(cat.cv_matched) - n(previous.catalogue?.cvMatched),
      pricedListings: n(price.priced_listings) - n(previous.pricing?.pricedListings),
      stale30dPlus: n(price.stale_30d) - n(previous.pricing?.stale30dPlus),
      productsPriced: n(price.products_priced) - n(previous.pricing?.productsPriced),
    } : null,
  }

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(JSON_PATH, JSON.stringify(snapshot, null, 2))

  const d = snapshot
  const delta = (k: keyof NonNullable<typeof snapshot.deltas>) =>
    d.deltas ? ` (${d.deltas[k] >= 0 ? '+' : ''}${d.deltas[k]} since ${String(d.previousSnapshotAt).slice(0, 10)})` : ''
  const md = `# Launch Health — ${d.generatedAt.slice(0, 16).replace('T', ' ')} UTC

Source: ${d.source}. ${d.deltas ? `Deltas vs ${String(d.previousSnapshotAt).slice(0, 10)}.` : '**No prior snapshot available** — deltas will appear from the next run.'}

## Catalogue
- Live products: **${d.catalogue.liveProducts.toLocaleString()}**${delta('liveProducts')}
- R2 covers: **${d.catalogue.coverR2.toLocaleString()} (${d.catalogue.coverR2Pct}%)**${delta('coverR2')} · no cover: ${d.catalogue.coverNone.toLocaleString()}
- Format known: ${d.catalogue.formatKnownPct}% · CV-matched: ${d.catalogue.cvMatched.toLocaleString()} (${d.catalogue.cvMatchedPct}%)${delta('cvMatched')}
- Descriptions: ${d.catalogue.described.toLocaleString()} · creators: ${d.catalogue.withCreators.toLocaleString()} · **suspect-flagged: ${d.catalogue.suspectFlagged}**

## Pricing
- Priced listings: **${d.pricing.pricedListings.toLocaleString()}**${delta('pricedListings')} · products priced: ${d.pricing.productsPriced.toLocaleString()}${delta('productsPriced')}
- Freshness: ${d.pricing.fresh7d.toLocaleString()} <7d · ${d.pricing.aged7to30d.toLocaleString()} 7–30d · **${d.pricing.stale30dPlus.toLocaleString()} stale (${d.pricing.stalePct}%)**${delta('stale30dPlus')}
- Comparison depth: ${d.pricing.comparisonDepth.oneRetailer.toLocaleString()} products @ 1 retailer · **${d.pricing.comparisonDepth.twoPlusRetailers} @ 2+**
${d.pricing.retailers.map(r => `- ${r.name}: ${r.listings.toLocaleString()} listings, ${r.fresh30d.toLocaleString()} fresh, last seen ${r.lastSeen}`).join('\n')}

## Amazon — AFFILIATE-ONLY / STORED OFFERS (informational, not a failure)
- No live Amazon price refresh is active · no paid third-party Amazon API is configured (Rainforest retired 2026-07-13)
- Stored listings: ${d.amazon.total} total · **${d.amazon.visibleOnSite} visible · ${d.amazon.suppressedAsStale} suppressed as stale**
- Observations: ${d.amazon.oldestSeen ?? 'n/a'} → ${d.amazon.newestSeen ?? 'n/a'} · remaining visible rows hidden by: **${d.amazon.allVisibleRowsGoStaleBy ?? 'n/a'}**
- ${d.amazon.note}
`
  writeFileSync(MD_PATH, md)
  console.log(md)
  console.log(`Recorded → launch/operations/launch-health-latest.{json,md}`)
}

main().catch(e => { console.error(e); process.exit(1) })
