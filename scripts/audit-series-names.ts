/**
 * scripts/audit-series-names.ts
 *
 * Audits seriesName data quality across the full catalogue.
 * Run with: npx tsx scripts/audit-series-names.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('=== CATCH COMICS — SERIES NAME DATA AUDIT ===\n')

  // ── 1. Overall stats ────────────────────────────────────────────────────────
  const totals = await prisma.$queryRaw<Array<{
    total: bigint
    with_series: bigint
    without_series: bigint
    distinct_series: bigint
    with_volume_number: bigint
    with_comicvine: bigint
  }>>`
    SELECT
      COUNT(*)                                                    AS total,
      COUNT(series_name)                                          AS with_series,
      COUNT(*) - COUNT(series_name)                               AS without_series,
      COUNT(DISTINCT series_name)                                 AS distinct_series,
      COUNT(volume_number)                                        AS with_volume_number,
      COUNT(comicvine_id)                                         AS with_comicvine
    FROM canonical_products
    WHERE deleted_at IS NULL
  `
  const t = totals[0]
  console.log('── OVERALL STATS ──────────────────────────────────')
  console.log(`Total live products:         ${t.total}`)
  console.log(`With series_name:            ${t.with_series} (${pct(t.with_series, t.total)}%)`)
  console.log(`Without series_name:         ${t.without_series} (${pct(t.without_series, t.total)}%)`)
  console.log(`Distinct series names:       ${t.distinct_series}`)
  console.log(`With volume_number:          ${t.with_volume_number} (${pct(t.with_volume_number, t.total)}%)`)
  console.log(`With comicvine_id:           ${t.with_comicvine} (${pct(t.with_comicvine, t.total)}%)`)
  console.log()

  // ── 2. Fragmentation: series with suspiciously many variants ────────────────
  // Strategy: normalize the base title (strip vol/volume trailing), then find
  // cases where 2+ distinct series_name values share the same base.
  const fragmented = await prisma.$queryRaw<Array<{
    base: string
    distinct_names: bigint
    product_count: bigint
    all_names: string
  }>>`
    SELECT
      LOWER(REGEXP_REPLACE(
        TRIM(series_name),
        '\s+(vol\.?|volume|book|part)\s*\d+.*$',
        '',
        'i'
      )) AS base,
      COUNT(DISTINCT series_name)   AS distinct_names,
      COUNT(*)                      AS product_count,
      STRING_AGG(DISTINCT series_name, ' | ' ORDER BY series_name) AS all_names
    FROM canonical_products
    WHERE deleted_at IS NULL
      AND series_name IS NOT NULL
      AND format NOT IN ('SINGLE_ISSUE')
    GROUP BY base
    HAVING COUNT(DISTINCT series_name) > 1
    ORDER BY product_count DESC
    LIMIT 60
  `

  console.log('── FRAGMENTED SERIES (same base, multiple series_name values) ──')
  console.log(`Found ${fragmented.length} potentially fragmented series\n`)
  fragmented.forEach((row, i) => {
    console.log(`${String(i + 1).padStart(2)}. [${row.product_count} products, ${row.distinct_names} variants] ${row.base}`)
    const names = row.all_names.split(' | ')
    names.forEach(n => console.log(`    • ${n}`))
  })
  console.log()

  // ── 3. Largest series by product count ─────────────────────────────────────
  const largestSeries = await prisma.$queryRaw<Array<{
    series_name: string
    product_count: bigint
    formats: string
    vol_num_coverage: string
    cv_coverage: string
  }>>`
    SELECT
      series_name,
      COUNT(*)                                                           AS product_count,
      STRING_AGG(DISTINCT format::text, ', ' ORDER BY format::text)     AS formats,
      ROUND(100.0 * COUNT(volume_number) / NULLIF(COUNT(*),0), 0) || '%' AS vol_num_coverage,
      ROUND(100.0 * COUNT(comicvine_id)  / NULLIF(COUNT(*),0), 0) || '%' AS cv_coverage
    FROM canonical_products
    WHERE deleted_at IS NULL
      AND series_name IS NOT NULL
      AND format NOT IN ('SINGLE_ISSUE')
    GROUP BY series_name
    ORDER BY product_count DESC
    LIMIT 50
  `

  console.log('── TOP 50 SERIES BY PRODUCT COUNT (excl. single issues) ──')
  console.log('  #  | Products | vol_num | cv_id | Formats | Series Name')
  console.log('-----|----------|---------|-------|---------|------------')
  largestSeries.forEach((row, i) => {
    const n = String(i + 1).padStart(3)
    const pc = String(row.product_count).padStart(8)
    const vn = row.vol_num_coverage.padStart(7)
    const cv = row.cv_coverage.padStart(5)
    const fmt = (row.formats || '').slice(0, 25).padEnd(25)
    console.log(`${n}  | ${pc} | ${vn} | ${cv} | ${fmt} | ${row.series_name}`)
  })
  console.log()

  // ── 4. volume_number completeness for multi-product series ─────────────────
  const volNumGaps = await prisma.$queryRaw<Array<{
    series_name: string
    total: bigint
    missing_vol_num: bigint
  }>>`
    SELECT
      series_name,
      COUNT(*)                                    AS total,
      COUNT(*) - COUNT(volume_number)             AS missing_vol_num
    FROM canonical_products
    WHERE deleted_at IS NULL
      AND series_name IS NOT NULL
      AND format NOT IN ('SINGLE_ISSUE')
    GROUP BY series_name
    HAVING COUNT(*) >= 3 AND COUNT(volume_number) < COUNT(*)
    ORDER BY missing_vol_num DESC
    LIMIT 30
  `

  console.log('── SERIES WITH MISSING volume_number (3+ products, some nulls) ──')
  volNumGaps.forEach(row => {
    console.log(`  ${row.series_name} — ${row.missing_vol_num}/${row.total} missing`)
  })
  console.log()

  // ── 5. CV enrichment as a fix signal ───────────────────────────────────────
  // For fragmented series: do the products in the same base group share a CV volume ID?
  // If yes, CV enrichment solves the grouping problem. If no, it doesn't.
  const cvOverlap = await prisma.$queryRaw<Array<{
    base: string
    products_with_cv: bigint
    total_products: bigint
    distinct_cv_ids: bigint
  }>>`
    SELECT
      LOWER(REGEXP_REPLACE(
        TRIM(series_name),
        '\s+(vol\.?|volume|book|part)\s*\d+.*$',
        '',
        'i'
      )) AS base,
      COUNT(comicvine_id) AS products_with_cv,
      COUNT(*)            AS total_products,
      COUNT(DISTINCT comicvine_id) AS distinct_cv_ids
    FROM canonical_products
    WHERE deleted_at IS NULL
      AND series_name IS NOT NULL
      AND format NOT IN ('SINGLE_ISSUE')
    GROUP BY base
    HAVING COUNT(DISTINCT series_name) > 1
      AND COUNT(comicvine_id) > 0
    ORDER BY products_with_cv DESC
    LIMIT 30
  `

  console.log('── CV ENRICHMENT COVERAGE FOR FRAGMENTED SERIES ──')
  console.log('(series where naming fragments AND some products have comicvine_id)')
  cvOverlap.forEach(row => {
    console.log(`  ${row.base}: ${row.products_with_cv}/${row.total_products} have CV id, ${row.distinct_cv_ids} distinct CV ids`)
  })
  console.log()

  // ── 6. Null series_name by format ───────────────────────────────────────────
  const nullByFormat = await prisma.$queryRaw<Array<{
    format: string
    total: bigint
    null_series: bigint
  }>>`
    SELECT
      format::text,
      COUNT(*)                        AS total,
      COUNT(*) - COUNT(series_name)   AS null_series
    FROM canonical_products
    WHERE deleted_at IS NULL
    GROUP BY format
    ORDER BY null_series DESC
  `

  console.log('── NULL series_name BY FORMAT ──')
  nullByFormat.forEach(row => {
    if (Number(row.null_series) > 0) {
      console.log(`  ${row.format}: ${row.null_series}/${row.total} null (${pct(row.null_series, row.total)}%)`)
    }
  })
  console.log()

  // ── 7. Series that would work well for MVP (clean data) ────────────────────
  const mvpCandidates = await prisma.$queryRaw<Array<{
    series_name: string
    product_count: bigint
    vol_complete: string
    cv_complete: string
    min_date: string
    formats: string
  }>>`
    SELECT
      series_name,
      COUNT(*)                                                               AS product_count,
      ROUND(100.0 * COUNT(volume_number) / NULLIF(COUNT(*),0), 0) || '%'    AS vol_complete,
      ROUND(100.0 * COUNT(comicvine_id)  / NULLIF(COUNT(*),0), 0) || '%'    AS cv_complete,
      TO_CHAR(MIN(release_date), 'YYYY')                                     AS min_date,
      STRING_AGG(DISTINCT format::text, ',' ORDER BY format::text)          AS formats
    FROM canonical_products
    WHERE deleted_at IS NULL
      AND series_name IS NOT NULL
      AND format NOT IN ('SINGLE_ISSUE')
    GROUP BY series_name
    HAVING COUNT(*) BETWEEN 2 AND 20
      AND COUNT(DISTINCT series_name) = 1
      AND COUNT(volume_number) = COUNT(*)  -- all have volume_number
      AND COUNT(comicvine_id) > 0          -- at least some CV enrichment
    ORDER BY COUNT(comicvine_id) DESC, COUNT(*) DESC
    LIMIT 30
  `

  console.log('── MVP CANDIDATE SERIES (2-20 products, complete vol_num, some CV) ──')
  mvpCandidates.forEach((row, i) => {
    console.log(`  ${String(i+1).padStart(2)}. [${row.product_count} vols, vol_num:${row.vol_complete}, cv:${row.cv_complete}] ${row.series_name}`)
  })
  console.log()

  console.log('=== AUDIT COMPLETE ===')
}

function pct(num: bigint, denom: bigint): string {
  if (Number(denom) === 0) return '0'
  return (Number(num) / Number(denom) * 100).toFixed(1)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
