/**
 * check-ouran-listings — Check retailer listing titles for unresolved Ouran volumes.
 * Retailer titles often include the volume number even when the canonical title doesn't.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const rows = await prisma.$queryRaw<Array<{
    isbn_13: string | null
    cp_title: string
    listing_title: string | null
    retailer_id: string
  }>>`
    SELECT cp.isbn_13, cp.title AS cp_title,
           rl.title AS listing_title, rl.retailer_id
    FROM canonical_products cp
    JOIN retailer_listings rl ON rl.canonical_product_id = cp.id AND rl.deleted_at IS NULL
    WHERE cp.deleted_at IS NULL
      AND cp.volume_number IS NULL
      AND cp.isbn_13 != '9781421550787'
      AND (cp.series_name ILIKE '%Ouran%' OR cp.title ILIKE 'Ouran%')
    ORDER BY cp.isbn_13, rl.retailer_id
  `

  console.log(`\nRetailer listings for unresolved Ouran products (${rows.length} rows):\n`)

  let lastIsbn = ''
  for (const r of rows) {
    if (r.isbn_13 !== lastIsbn) {
      console.log(`\nISBN: ${r.isbn_13}`)
      lastIsbn = r.isbn_13 ?? ''
    }
    const title = r.listing_title ?? 'NULL'
    console.log(`  [${r.retailer_id.padEnd(20)}] ${title.slice(0, 90)}`)
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
