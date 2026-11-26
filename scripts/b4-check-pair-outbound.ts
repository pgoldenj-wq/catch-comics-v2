/**
 * b4-check-pair-outbound.ts — READ-ONLY. Resolves the /go/<id> links found on a
 * live two-retailer product page back to their stored listings, so the outbound
 * destination can be confirmed WITHOUT firing the redirect.
 *
 * /go/[id] logs a click for affiliate attribution, so fetching it to "check"
 * would write a false click into the analytics it feeds. This reads the same
 * rows the redirect would read instead.
 *
 *   npx dotenv -e <main>/.env.local -- npx tsx scripts/b4-check-pair-outbound.ts <id> [<id> ...]
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const ids = process.argv.slice(2).filter(a => /^[0-9a-f-]{36}$/i.test(a))
  if (ids.length === 0) {
    console.error('usage: b4-check-pair-outbound.ts <listing-uuid> [<listing-uuid> ...]')
    process.exit(1)
  }

  const rows = await prisma.retailerListing.findMany({
    where:  { id: { in: ids } },
    select: {
      id: true, priceAmount: true, stockStatus: true, deletedAt: true,
      retailerUrl: true, retailerSku: true,
      retailer:         { select: { name: true, domain: true } },
      canonicalProduct: { select: { canonicalSlug: true, title: true } },
    },
  })

  for (const r of rows) {
    let host = 'unparseable'
    try { host = new URL(r.retailerUrl).host } catch { /* reported as-is */ }
    console.log(`${r.retailer.name}`)
    console.log(`  listing        ${r.id}`)
    console.log(`  price          £${r.priceAmount}  ${r.stockStatus}  deleted_at=${r.deletedAt === null ? 'NULL (live)' : r.deletedAt.toISOString()}`)
    console.log(`  retailer domain${' '.repeat(1)} ${r.retailer.domain}`)
    console.log(`  stored url host ${host}  ${host.endsWith(r.retailer.domain) ? 'MATCHES the retailer' : 'DOES NOT MATCH the retailer'}`)
    console.log(`  sku            ${r.retailerSku}`)
    console.log(`  product        ${r.canonicalProduct?.canonicalSlug ?? '—'}`)
  }
  console.log(`\nresolved ${rows.length} of ${ids.length} ids · zero redirects fired · zero clicks logged`)

  await prisma.$disconnect()
}

main().catch(async e => {
  await prisma.$disconnect()
  console.error(e)
  process.exit(1)
})
