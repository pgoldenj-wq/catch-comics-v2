/**
 * verify-ouran-ready — Final pre-build check for Ouran OHSHC series page.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const OURAN_CV = '26278'

async function main() {
  const rows = await prisma.$queryRaw<Array<{
    id: string
    title: string
    isbn_13: string | null
    format: string
    volume_number: number | null
    comicvine_id: string | null
    series_name: string | null
    cover_image_url: string | null
    min_price: string | null
    retailer_count: bigint
  }>>`
    SELECT
      cp.id, cp.title, cp.isbn_13, cp.format::text, cp.volume_number,
      cp.comicvine_id, cp.series_name, cp.cover_image_url,
      MIN(CASE WHEN rl.stock_status IN ('IN_STOCK','LOW_STOCK','PREORDER') AND rl.price_amount > 0
               THEN rl.price_amount END)::text AS min_price,
      COUNT(DISTINCT CASE WHEN rl.stock_status IN ('IN_STOCK','LOW_STOCK','PREORDER') AND rl.price_amount > 0
                          THEN rl.retailer_id END) AS retailer_count
    FROM canonical_products cp
    LEFT JOIN retailer_listings rl ON rl.canonical_product_id = cp.id AND rl.deleted_at IS NULL
    WHERE cp.deleted_at IS NULL
      AND cp.comicvine_id = ${OURAN_CV}
      AND cp.isbn_13 != '9781421550787'
    GROUP BY cp.id
    ORDER BY cp.volume_number ASC NULLS LAST, cp.title
  `

  console.log(`\nOuran products (cv:${OURAN_CV}): ${rows.length}`)
  console.log('='.repeat(70))

  let issues: string[] = []

  for (const r of rows) {
    const price  = r.min_price ? `£${parseFloat(r.min_price).toFixed(2)}` : 'no price'
    const cover  = r.cover_image_url ? '✓' : '✗ missing'
    const cvOk   = r.comicvine_id === OURAN_CV ? '✓' : `✗ cv=${r.comicvine_id}`
    const fmtOk  = r.format === 'MANGA_VOLUME' ? '✓' : `✗ ${r.format}`

    console.log(`Vol.${String(r.volume_number ?? '?').padEnd(3)} | ` +
                `cv:${cvOk} fmt:${fmtOk} cover:${cover} price:${price} (${r.retailer_count}ret)`)

    if (!r.cover_image_url)       issues.push(`Vol.${r.volume_number}: no cover`)
    if (r.format !== 'MANGA_VOLUME') issues.push(`Vol.${r.volume_number}: wrong format ${r.format}`)
    if (r.comicvine_id !== OURAN_CV) issues.push(`Vol.${r.volume_number}: wrong cv ${r.comicvine_id}`)
  }

  // Check for volume continuity 1-18
  const vols = rows.map(r => r.volume_number).filter(v => v !== null) as number[]
  const missing = Array.from({ length: 18 }, (_, i) => i + 1).filter(v => !vols.includes(v))
  const nullVols = rows.filter(r => r.volume_number === null)

  console.log('\n' + '─'.repeat(70))
  console.log(`Volumes present: [${vols.join(', ')}]`)
  if (missing.length) { console.log(`⚠ Missing from 1-18: [${missing.join(', ')}]`); issues.push(`Missing vols: ${missing}`) }
  if (nullVols.length) { console.log(`⚠ ${nullVols.length} product(s) still have NULL volume_number`); issues.push('NULL volume_numbers remain') }

  // Check Vol 1 pricing
  const vol1 = rows.find(r => r.volume_number === 1)
  if (vol1) {
    const vol1Price = vol1.min_price ? parseFloat(vol1.min_price) : null
    if (!vol1Price) { console.log('⚠ Vol.1 has no price!'); issues.push('Vol.1 not priced') }
    else { console.log(`Vol.1 price: £${vol1Price.toFixed(2)} from ${vol1.retailer_count} retailer(s)`) }
  }

  // Check cover coverage
  const noCover = rows.filter(r => !r.cover_image_url)
  console.log(`Cover coverage: ${rows.length - noCover.length}/${rows.length}`)
  if (noCover.length > 0) {
    noCover.forEach(r => console.log(`  ✗ Vol.${r.volume_number} "${r.title.slice(0,40)}" — no cover`))
  }

  if (issues.length === 0) {
    console.log('\n✅ READY TO BUILD — No issues found')
  } else {
    console.log('\n⚠ Issues to resolve:')
    issues.forEach(i => console.log(`  - ${i}`))
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
