/**
 * detail-query-wha — full product dump for Witch Hat Atelier audit.
 *
 * CV ids:
 *   118208 = Witch Hat Atelier (main series)
 *   154952 = Witch Hat Atelier Kitchen (spin-off)
 */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const rows = await prisma.$queryRaw<Array<{
    id: string; title: string; isbn_13: string | null; format: string;
    series_name: string | null; volume_number: number | null;
    comicvine_id: string | null; cover_image_url: string | null;
    canonical_slug: string; listing_count: bigint;
    min_price: string | null; retailer_count: bigint;
  }>>`
    SELECT
      cp.id, cp.title, cp.isbn_13, cp.format::text, cp.series_name,
      cp.volume_number, cp.comicvine_id, cp.cover_image_url,
      cp.canonical_slug,
      COUNT(DISTINCT rl.id) AS listing_count,
      MIN(CASE WHEN rl.stock_status IN ('IN_STOCK','LOW_STOCK','PREORDER')
               THEN rl.price_amount END)::text AS min_price,
      COUNT(DISTINCT CASE WHEN rl.stock_status IN ('IN_STOCK','LOW_STOCK','PREORDER')
                          THEN rl.retailer_id END) AS retailer_count
    FROM canonical_products cp
    LEFT JOIN retailer_listings rl
      ON rl.canonical_product_id = cp.id AND rl.deleted_at IS NULL
    WHERE cp.deleted_at IS NULL
      AND (cp.series_name ILIKE '%Witch Hat%' OR cp.title ILIKE 'Witch Hat%')
    GROUP BY cp.id
    ORDER BY cp.comicvine_id, cp.volume_number ASC NULLS LAST, cp.title
  `

  console.log(`\nWitch Hat Atelier products: ${rows.length}\n`)
  for (const r of rows) {
    const price  = r.min_price ? `£${parseFloat(r.min_price).toFixed(2)}` : 'no price'
    const cover  = r.cover_image_url ? r.cover_image_url.slice(0, 80) : 'NULL'
    console.log(`--- cv:${r.comicvine_id ?? 'NULL'} Vol.${r.volume_number ?? '?'} [${r.format}]`)
    console.log(`    id:     ${r.id}`)
    console.log(`    title:  ${r.title}`)
    console.log(`    isbn:   ${r.isbn_13 ?? 'NULL'}`)
    console.log(`    series: ${r.series_name ?? 'NULL'}`)
    console.log(`    price:  ${price} (${r.retailer_count} retailers, ${r.listing_count} listings)`)
    console.log(`    cover:  ${cover}`)
  }

  // --- Products with volume_number set ---
  const withVol = rows.filter(r => r.volume_number !== null)
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Products WITH volume_number set: ${withVol.length}`)
  console.log(`${'='.repeat(60)}`)
  for (const r of withVol) {
    const price = r.min_price ? `£${parseFloat(r.min_price).toFixed(2)}` : 'no price'
    console.log(`  Vol.${r.volume_number} [${r.format}] cv:${r.comicvine_id ?? 'NULL'}`)
    console.log(`    title:  ${r.title}`)
    console.log(`    isbn:   ${r.isbn_13 ?? 'NULL'}`)
    console.log(`    slug:   /product/${r.canonical_slug}`)
    console.log(`    price:  ${price} (${r.retailer_count} retailers, ${r.listing_count} listings)`)
  }

  // --- Main series (cv:118208) breakdown ---
  const main = rows.filter(r => r.comicvine_id === '118208')
  const kitchen = rows.filter(r => r.comicvine_id === '154952')
  const other = rows.filter(r => r.comicvine_id !== '118208' && r.comicvine_id !== '154952')

  console.log(`\n${'='.repeat(60)}`)
  console.log(`BREAKDOWN BY COMICVINE ID`)
  console.log(`${'='.repeat(60)}`)
  console.log(`cv:118208 (main series):        ${main.length} products`)
  console.log(`cv:154952 (Kitchen spin-off):   ${kitchen.length} products`)
  console.log(`Other / NULL cv:                ${other.length} products`)

  // --- Format breakdown for main series ---
  const formatCounts: Record<string, number> = {}
  for (const r of main) {
    formatCounts[r.format] = (formatCounts[r.format] ?? 0) + 1
  }
  console.log(`\ncv:118208 format breakdown:`)
  for (const [fmt, count] of Object.entries(formatCounts)) {
    console.log(`  ${fmt}: ${count}`)
  }

  // --- Volume numbers set for main series ---
  const mainWithVol = main.filter(r => r.volume_number !== null)
  const mainVolNums = mainWithVol.map(r => r.volume_number!).sort((a, b) => a - b)
  console.log(`\ncv:118208 volume numbers set: [${mainVolNums.join(', ')}]`)

  // --- Check for duplicate volumes (same vol_number, different format) ---
  console.log(`\n${'='.repeat(60)}`)
  console.log(`DUPLICATE VOLUME CHECK (same vol_number, different entries)`)
  console.log(`${'='.repeat(60)}`)
  const volGroups: Record<number, typeof rows> = {}
  for (const r of main) {
    if (r.volume_number !== null) {
      if (!volGroups[r.volume_number]) volGroups[r.volume_number] = []
      volGroups[r.volume_number].push(r)
    }
  }
  let hasDupes = false
  for (const [vol, group] of Object.entries(volGroups)) {
    if (group.length > 1) {
      hasDupes = true
      console.log(`  Vol.${vol} has ${group.length} entries:`)
      for (const r of group) {
        console.log(`    [${r.format}] "${r.title}" isbn=${r.isbn_13 ?? 'NULL'}`)
      }
    }
  }
  if (!hasDupes) {
    console.log('  No duplicate volume numbers found in cv:118208.')
  }

  // --- Vol.1 canonical slug ---
  const vol1 = main.find(r => r.volume_number === 1)
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Vol.1 MAIN SERIES CANONICAL SLUG`)
  console.log(`${'='.repeat(60)}`)
  if (vol1) {
    console.log(`  title:  ${vol1.title}`)
    console.log(`  format: ${vol1.format}`)
    console.log(`  slug:   /product/${vol1.canonical_slug}`)
    console.log(`  isbn:   ${vol1.isbn_13 ?? 'NULL'}`)
  } else {
    console.log('  No Vol.1 found with volume_number=1 in cv:118208')
  }

  // --- Kitchen spin-off summary ---
  if (kitchen.length > 0) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`KITCHEN SPIN-OFF (cv:154952) — ${kitchen.length} products`)
    console.log(`${'='.repeat(60)}`)
    for (const r of kitchen) {
      const price = r.min_price ? `£${parseFloat(r.min_price).toFixed(2)}` : 'no price'
      console.log(`  Vol.${r.volume_number ?? '?'} [${r.format}] "${r.title}"`)
      console.log(`    isbn:  ${r.isbn_13 ?? 'NULL'}  price: ${price}`)
    }
  }

  // --- Other/NULL cv summary ---
  if (other.length > 0) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`OTHER / NULL CV — ${other.length} products`)
    console.log(`${'='.repeat(60)}`)
    for (const r of other) {
      const price = r.min_price ? `£${parseFloat(r.min_price).toFixed(2)}` : 'no price'
      console.log(`  cv:${r.comicvine_id ?? 'NULL'} Vol.${r.volume_number ?? '?'} [${r.format}] "${r.title}"`)
      console.log(`    isbn:  ${r.isbn_13 ?? 'NULL'}  price: ${price}`)
    }
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
