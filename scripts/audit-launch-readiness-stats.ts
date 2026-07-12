/**
 * audit-launch-readiness-stats.ts — READ-ONLY launch-readiness data audit.
 *
 * Prints catalogue / cover / pricing / trust coverage stats used by the
 * product-excellence audit (launch/product-excellence/). No writes, ever.
 *
 * Run: dotenv -e .env.local -- tsx scripts/audit-launch-readiness-stats.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const say = (label: string, v: unknown) =>
    console.log(`${label}: ${JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? String(x) : x))}`)

  // ── Catalogue shape ────────────────────────────────────────────────────────
  const total = await prisma.canonicalProduct.count({ where: { deletedAt: null } })
  say('LIVE_PRODUCTS', total)

  const byFormat = await prisma.$queryRaw<Array<{ format: string; n: bigint }>>`
    SELECT format::text AS format, COUNT(*) AS n
    FROM canonical_products WHERE deleted_at IS NULL
    GROUP BY format ORDER BY n DESC`
  say('BY_FORMAT', byFormat.map(r => `${r.format}=${r.n}`))

  // ── Cover coverage by host ─────────────────────────────────────────────────
  const covers = await prisma.$queryRaw<Array<{ bucket: string; n: bigint }>>`
    SELECT CASE
      WHEN cover_image_url IS NULL THEN 'none'
      WHEN cover_image_url LIKE '%images.catchcomics.com%' THEN 'r2'
      WHEN cover_image_url LIKE '%comicvine%' THEN 'comicvine'
      WHEN cover_image_url LIKE '%openlibrary%' THEN 'openlibrary'
      WHEN cover_image_url LIKE '%books.google%' THEN 'googlebooks'
      WHEN cover_image_url LIKE '%productserve%' OR cover_image_url LIKE '%awin%' THEN 'AWIN_BAD'
      ELSE 'other' END AS bucket, COUNT(*) AS n
    FROM canonical_products WHERE deleted_at IS NULL
    GROUP BY 1 ORDER BY n DESC`
  say('COVER_HOSTS', covers.map(r => `${r.bucket}=${r.n}`))

  // ── CV metadata / trust flags ──────────────────────────────────────────────
  const cv = await prisma.$queryRaw<Array<{ k: string; n: bigint }>>`
    SELECT 'has_comicvine_id' AS k, COUNT(*) AS n FROM canonical_products
      WHERE deleted_at IS NULL AND comicvine_id IS NOT NULL
    UNION ALL
    SELECT 'has_creators', COUNT(*) FROM canonical_products
      WHERE deleted_at IS NULL AND cv_metadata ? 'creators'
        AND jsonb_array_length(cv_metadata->'creators') > 0
    UNION ALL
    SELECT 'cv_match_suspect', COUNT(*) FROM canonical_products
      WHERE deleted_at IS NULL AND cv_metadata ? 'cv_match_suspect'
        AND cv_metadata->>'cv_match_suspect' NOT IN ('false', 'null')
    UNION ALL
    SELECT 'has_description', COUNT(*) FROM canonical_products
      WHERE deleted_at IS NULL AND description IS NOT NULL AND length(description) > 30
    UNION ALL
    SELECT 'has_isbn13', COUNT(*) FROM canonical_products
      WHERE deleted_at IS NULL AND isbn_13 IS NOT NULL
    UNION ALL
    SELECT 'has_release_date', COUNT(*) FROM canonical_products
      WHERE deleted_at IS NULL AND release_date IS NOT NULL
    UNION ALL
    SELECT 'has_series_name', COUNT(*) FROM canonical_products
      WHERE deleted_at IS NULL AND series_name IS NOT NULL`
  say('CV_TRUST', cv.map(r => `${r.k}=${r.n}`))

  // ── Listings / pricing freshness ───────────────────────────────────────────
  const listings = await prisma.$queryRaw<Array<{ k: string; n: bigint }>>`
    SELECT 'active_priced_listings' AS k, COUNT(*) AS n FROM retailer_listings l
      JOIN retailers r ON r.id = l.retailer_id
      WHERE l.deleted_at IS NULL AND l.price_amount > 0 AND r.is_active
    UNION ALL
    SELECT 'fresh_7d', COUNT(*) FROM retailer_listings l
      JOIN retailers r ON r.id = l.retailer_id
      WHERE l.deleted_at IS NULL AND l.price_amount > 0 AND r.is_active
        AND l.last_seen_at > NOW() - INTERVAL '7 days'
    UNION ALL
    SELECT 'aged_7_30d', COUNT(*) FROM retailer_listings l
      JOIN retailers r ON r.id = l.retailer_id
      WHERE l.deleted_at IS NULL AND l.price_amount > 0 AND r.is_active
        AND l.last_seen_at <= NOW() - INTERVAL '7 days'
        AND l.last_seen_at > NOW() - INTERVAL '30 days'
    UNION ALL
    SELECT 'stale_30d_plus', COUNT(*) FROM retailer_listings l
      JOIN retailers r ON r.id = l.retailer_id
      WHERE l.deleted_at IS NULL AND l.price_amount > 0 AND r.is_active
        AND l.last_seen_at <= NOW() - INTERVAL '30 days'
    UNION ALL
    SELECT 'dynamic_link_stubs', COUNT(*) FROM retailer_listings l
      JOIN retailers r ON r.id = l.retailer_id
      WHERE l.deleted_at IS NULL AND l.price_amount <= 0 AND r.is_active`
  say('LISTINGS', listings.map(r => `${r.k}=${r.n}`))

  // Products with at least one live priced listing
  const priced = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(DISTINCT l.canonical_product_id) AS n FROM retailer_listings l
      JOIN retailers r ON r.id = l.retailer_id
      WHERE l.deleted_at IS NULL AND l.price_amount > 0 AND r.is_active`
  say('PRODUCTS_WITH_PRICED_LISTING', priced[0]?.n)

  const pricedFresh = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(DISTINCT l.canonical_product_id) AS n FROM retailer_listings l
      JOIN retailers r ON r.id = l.retailer_id
      WHERE l.deleted_at IS NULL AND l.price_amount > 0 AND r.is_active
        AND l.last_seen_at > NOW() - INTERVAL '30 days'`
  say('PRODUCTS_WITH_FRESH_PRICED_LISTING_30D', pricedFresh[0]?.n)

  // ── Retailer breakdown ─────────────────────────────────────────────────────
  const retailers = await prisma.$queryRaw<Array<{ name: string; n: bigint; fresh: bigint; last: Date | null }>>`
    SELECT r.name, COUNT(l.id) AS n,
      COUNT(l.id) FILTER (WHERE l.last_seen_at > NOW() - INTERVAL '30 days') AS fresh,
      MAX(l.last_seen_at) AS last
    FROM retailers r
    LEFT JOIN retailer_listings l
      ON l.retailer_id = r.id AND l.deleted_at IS NULL AND l.price_amount > 0
    WHERE r.is_active
    GROUP BY r.name ORDER BY n DESC`
  for (const r of retailers) {
    console.log(`RETAILER: ${r.name} listings=${r.n} fresh30d=${r.fresh} lastSeen=${r.last?.toISOString()?.slice(0, 10) ?? 'never'}`)
  }

  // ── Price history depth ────────────────────────────────────────────────────
  const ph = await prisma.$queryRaw<Array<{ n: bigint; listings: bigint }>>`
    SELECT COUNT(*) AS n, COUNT(DISTINCT retailer_listing_id) AS listings FROM price_history`
  say('PRICE_HISTORY', { rows: String(ph[0]?.n), listings: String(ph[0]?.listings) })

  // ── Comparison depth — products with 2+ distinct priced retailers ─────────
  const depth = await prisma.$queryRaw<Array<{ retailers: bigint; products: bigint }>>`
    SELECT retailers, COUNT(*) AS products FROM (
      SELECT l.canonical_product_id, COUNT(DISTINCT l.retailer_id) AS retailers
      FROM retailer_listings l
      JOIN retailers r ON r.id = l.retailer_id
      WHERE l.deleted_at IS NULL AND l.price_amount > 0 AND r.is_active
      GROUP BY l.canonical_product_id
    ) t GROUP BY retailers ORDER BY retailers`
  say('COMPARISON_DEPTH', depth.map(r => `${r.retailers}retailers=${r.products}`))

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
