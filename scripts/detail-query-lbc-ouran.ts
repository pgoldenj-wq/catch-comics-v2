/**
 * detail-query-lbc-ouran — full product dump for Laid-Back Camp and Ouran audit.
 *
 * SERIES 1: Laid-Back Camp (CV id: 109427)
 * SERIES 2: Ouran High School Host Club (CV id: 26278)
 *
 * Goals:
 *  - Identify which unnumbered products have extractable volume numbers from title
 *  - Flag supplementals (box sets, complete collections) that should NOT be in reading order
 *
 * READ-ONLY. No database modifications.
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

type Row = {
  id: string
  title: string
  isbn_13: string | null
  format: string
  series_name: string | null
  volume_number: number | null
  comicvine_id: string | null
  cover_image_url: string | null
  deleted_at: Date | null
  listing_count: bigint
  min_price: string | null
  retailer_count: bigint
}

/** Try to extract a volume number from a title string. Returns null if none found. */
function extractVolFromTitle(title: string): number | null {
  // Patterns to try, in priority order:
  const patterns = [
    /\bVol\.?\s*(\d+)/i,          // "Vol. 1" or "Vol 1"
    /\bVolume\s+(\d+)/i,          // "Volume 1"
    /\b#\s*(\d+)\b/,              // "#1"
    /\bHost\s*Club\s*#\s*(\d+)/i, // "Host Club #1"
    /\(\s*(\d+)\s*\)$/,           // "(1)" at end
  ]
  for (const p of patterns) {
    const m = title.match(p)
    if (m) return parseInt(m[1], 10)
  }
  return null
}

/** Classify a product as a supplemental (box set, complete collection, etc.) */
function isSupplemental(title: string): string | null {
  const t = title.toLowerCase()
  if (/box\s*set/.test(t)) return 'BOX SET'
  if (/complete\s*(collection|series|edition)/.test(t)) return 'COMPLETE COLLECTION'
  if (/omnibus/.test(t)) return 'OMNIBUS'
  if (/collector'?s?\s*(edition|set)/.test(t)) return "COLLECTOR'S EDITION"
  if (/\bset\b/.test(t) && /\bvol(ume)?s?\b/.test(t)) return 'MULTI-VOL SET'
  if (/\bantho(logy)?\b/.test(t)) return 'ANTHOLOGY'
  return null
}

function printRows(seriesLabel: string, cvId: string, rows: Row[]) {
  console.log(`\n${'='.repeat(72)}`)
  console.log(`${seriesLabel}  (CV id: ${cvId})`)
  console.log(`Total products: ${rows.length}`)
  console.log('='.repeat(72))

  const unnumbered: Row[] = []
  const supplementals: Array<{ title: string; kind: string }> = []

  for (const r of rows) {
    const price = r.min_price ? `£${parseFloat(r.min_price).toFixed(2)}` : 'no price'
    const cover = r.cover_image_url ? r.cover_image_url.slice(0, 60) : 'NULL'
    const suppKind = isSupplemental(r.title)

    const volDisplay = r.volume_number !== null ? String(r.volume_number) : '?'
    const cvDisplay = r.comicvine_id ?? 'NULL'
    const deletedTag = r.deleted_at ? `  [DELETED: ${r.deleted_at.toISOString()}]` : ''
    const suppTag = suppKind ? `  [SUPPLEMENTAL: ${suppKind}]` : ''

    console.log(`\n  --- cv:${cvDisplay}  Vol.${volDisplay}  [${r.format}]${deletedTag}${suppTag}`)
    console.log(`      id:          ${r.id}`)
    console.log(`      title:       ${r.title}`)
    console.log(`      isbn_13:     ${r.isbn_13 ?? 'NULL'}`)
    console.log(`      series_name: ${r.series_name ?? 'NULL'}`)
    console.log(`      cover:       ${cover}`)
    console.log(`      listings:    ${r.listing_count} total  |  price: ${price}  |  retailers: ${r.retailer_count}`)

    if (r.volume_number === null) {
      const extracted = extractVolFromTitle(r.title)
      if (extracted !== null) {
        console.log(`      ** EXTRACTABLE vol from title: Vol.${extracted}`)
      } else {
        console.log(`      ** vol_number is NULL, no extraction possible`)
      }
      unnumbered.push(r)
    }

    if (suppKind) {
      supplementals.push({ title: r.title, kind: suppKind })
    }
  }

  // Summary
  console.log(`\n${'─'.repeat(72)}`)
  console.log(`SUMMARY for ${seriesLabel}`)
  console.log(`  Total products:    ${rows.length}`)
  console.log(`  Numbered (vol_num set): ${rows.length - unnumbered.length}`)
  console.log(`  Unnumbered:        ${unnumbered.length}`)

  const extractable = unnumbered.filter(r => extractVolFromTitle(r.title) !== null)
  console.log(`  Extractable from title: ${extractable.length}`)
  if (extractable.length > 0) {
    for (const r of extractable) {
      const n = extractVolFromTitle(r.title)!
      console.log(`    -> Vol.${n}  "${r.title}"`)
    }
  }

  const notExtractable = unnumbered.filter(r => extractVolFromTitle(r.title) === null)
  console.log(`  Not extractable:   ${notExtractable.length}`)
  if (notExtractable.length > 0) {
    for (const r of notExtractable) {
      console.log(`    -> "${r.title}"`)
    }
  }

  console.log(`  Supplementals:     ${supplementals.length}`)
  if (supplementals.length > 0) {
    for (const s of supplementals) {
      console.log(`    -> [${s.kind}] "${s.title}"`)
    }
  }

  // Volume number coverage (for numbered items)
  const numbered = rows
    .filter(r => r.volume_number !== null)
    .map(r => r.volume_number!)
    .sort((a, b) => a - b)
  if (numbered.length > 0) {
    const maxVol = numbered[numbered.length - 1]
    const missing: number[] = []
    for (let i = 1; i <= maxVol; i++) {
      if (!numbered.includes(i)) missing.push(i)
    }
    console.log(`  Numbered vols present: [${numbered.join(', ')}]`)
    if (missing.length > 0) {
      console.log(`  Gaps in 1-${maxVol}: [${missing.join(', ')}]`)
    } else {
      console.log(`  No gaps in 1-${maxVol}`)
    }
  }
}

async function main() {
  // ── SERIES 1: Laid-Back Camp ──────────────────────────────────────────────
  const lbcRows = await prisma.$queryRaw<Row[]>`
    SELECT
      cp.id, cp.title, cp.isbn_13, cp.format::text, cp.series_name,
      cp.volume_number, cp.comicvine_id, cp.cover_image_url, cp.deleted_at,
      COUNT(DISTINCT rl.id)                                          AS listing_count,
      MIN(CASE WHEN rl.stock_status IN ('IN_STOCK','LOW_STOCK','PREORDER')
               THEN rl.price_amount END)::text                      AS min_price,
      COUNT(DISTINCT CASE WHEN rl.stock_status IN ('IN_STOCK','LOW_STOCK','PREORDER')
                          THEN rl.retailer_id END)                  AS retailer_count
    FROM canonical_products cp
    LEFT JOIN retailer_listings rl
      ON rl.canonical_product_id = cp.id AND rl.deleted_at IS NULL
    WHERE cp.deleted_at IS NULL
      AND (
        cp.series_name ILIKE '%Laid%Camp%'
        OR cp.title    ILIKE 'Laid%Camp%'
        OR cp.title    ILIKE 'Yuru Camp%'
      )
    GROUP BY cp.id
    ORDER BY cp.volume_number ASC NULLS LAST, cp.title
  `

  // ── SERIES 2: Ouran High School Host Club ─────────────────────────────────
  const ouranRows = await prisma.$queryRaw<Row[]>`
    SELECT
      cp.id, cp.title, cp.isbn_13, cp.format::text, cp.series_name,
      cp.volume_number, cp.comicvine_id, cp.cover_image_url, cp.deleted_at,
      COUNT(DISTINCT rl.id)                                          AS listing_count,
      MIN(CASE WHEN rl.stock_status IN ('IN_STOCK','LOW_STOCK','PREORDER')
               THEN rl.price_amount END)::text                      AS min_price,
      COUNT(DISTINCT CASE WHEN rl.stock_status IN ('IN_STOCK','LOW_STOCK','PREORDER')
                          THEN rl.retailer_id END)                  AS retailer_count
    FROM canonical_products cp
    LEFT JOIN retailer_listings rl
      ON rl.canonical_product_id = cp.id AND rl.deleted_at IS NULL
    WHERE cp.deleted_at IS NULL
      AND (
        cp.series_name ILIKE '%Ouran%'
        OR cp.title    ILIKE 'Ouran%'
      )
    GROUP BY cp.id
    ORDER BY cp.volume_number ASC NULLS LAST, cp.title
  `

  printRows('Laid-Back Camp', '109427', lbcRows)
  printRows('Ouran High School Host Club', '26278', ouranRows)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
