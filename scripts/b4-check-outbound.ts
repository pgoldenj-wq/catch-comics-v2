/**
 * b4-check-outbound.ts — READ-ONLY.
 *
 * Resolves a /go/<id> affiliate id to its listing and prints the outbound
 * destination, so the redirect target can be confirmed WITHOUT issuing a real
 * clickout (which would write a click_events row and skew launch:signal).
 *
 *   npx dotenv -e <main>/.env.local -- npx tsx scripts/b4-check-outbound.ts <listing-id>
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const id = process.argv[2]
  if (!id) throw new Error('usage: b4-check-outbound.ts <listing-id>')

  const row = await prisma.retailerListing.findUnique({
    where:  { id },
    select: {
      id: true, retailerUrl: true, retailerSku: true, priceAmount: true,
      priceCurrency: true, stockStatus: true, deletedAt: true, lastSeenAt: true,
      condition: true, isbn13: true,
      retailer: { select: { name: true, domain: true, affiliateNetwork: true, countryCode: true } },
      canonicalProduct: { select: { canonicalSlug: true, title: true, isbn13: true } },
    },
  })
  if (!row) throw new Error(`listing ${id} not found`)

  console.log(`listing            ${row.id}`)
  console.log(`product            ${row.canonicalProduct?.title}`)
  console.log(`slug               ${row.canonicalProduct?.canonicalSlug}`)
  console.log(`product ISBN       ${row.canonicalProduct?.isbn13 ?? '—'}`)
  console.log(`listing ISBN       ${row.isbn13 ?? '—'}`)
  console.log(`retailer           ${row.retailer.name}  (${row.retailer.domain}, ${row.retailer.countryCode})`)
  console.log(`affiliate network  ${row.retailer.affiliateNetwork ?? 'none — direct link'}`)
  console.log(`price              ${row.priceCurrency} ${row.priceAmount}`)
  console.log(`condition          ${row.condition}`)
  console.log(`stock              ${row.stockStatus}`)
  console.log(`active             ${row.deletedAt === null ? 'yes (deleted_at NULL)' : `no — deleted_at ${row.deletedAt.toISOString()}`}`)
  console.log(`last seen          ${row.lastSeenAt.toISOString()}`)
  console.log(`outbound URL       ${row.retailerUrl}`)
  console.log(`retailer SKU       ${row.retailerSku}`)

  await prisma.$disconnect()
}

main().catch(async e => {
  await prisma.$disconnect()
  console.error(e)
  process.exit(1)
})
