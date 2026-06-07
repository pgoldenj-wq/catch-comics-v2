/**
 * detail-query-trigun — full product dump for Trigun Maximum Deluxe audit.
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
      AND (cp.series_name ILIKE '%Trigun%' OR cp.title ILIKE '%Trigun%')
    GROUP BY cp.id
    ORDER BY cp.comicvine_id, cp.volume_number ASC NULLS LAST, cp.title
  `

  console.log(`\nTrigun products: ${rows.length}\n`)
  for (const r of rows) {
    const price  = r.min_price ? `£${parseFloat(r.min_price).toFixed(2)}` : 'no price'
    const cover  = r.cover_image_url ? r.cover_image_url.slice(0,70) : 'NULL'
    console.log(`--- cv:${r.comicvine_id ?? 'NULL'} Vol.${r.volume_number ?? '?'} [${r.format}]`)
    console.log(`    title:  ${r.title}`)
    console.log(`    isbn:   ${r.isbn_13 ?? 'NULL'}`)
    console.log(`    slug:   /product/${r.canonical_slug}`)
    console.log(`    price:  ${price} (${r.retailer_count} retailers, ${r.listing_count} listings)`)
    console.log(`    cover:  ${cover}`)
  }

  // Specifically show the 5 cv:29569 products
  const main5 = rows.filter(r => r.comicvine_id === '29569')
  const volNums = main5.map(r => r.volume_number).sort((a,b) => (a??99)-(b??99))
  console.log(`\ncv:29569 (Trigun Maximum Deluxe): ${main5.length} products`)
  console.log(`Volume numbers: [${volNums.join(', ')}]`)
  const missing = [1,2,3,4,5].filter(n => !volNums.includes(n))
  console.log(`Missing from 1-5: [${missing.join(', ')}]`)

  const orphan = rows.filter(r => r.comicvine_id === '29518')
  if (orphan.length > 0) {
    console.log(`\ncv:29518 (likely original Trigun): ${orphan.length} products`)
    orphan.forEach(r => console.log(`  "${r.title}" isbn=${r.isbn_13}`))
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
