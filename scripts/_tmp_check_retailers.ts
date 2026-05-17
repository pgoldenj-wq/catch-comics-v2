import { prisma } from '../lib/prisma'

async function main() {
const lbb = await prisma.retailer.findUnique({ where: { domain: 'letsbuybooks.com' } })
const bks = await prisma.retailer.findUnique({ where: { domain: 'uk.bookshop.org' } })

const bkStubsTotal    = await prisma.retailerListing.count({ where: { retailer: { domain: 'uk.bookshop.org' }, deletedAt: null } })
const bkStubsWithIsbn = await prisma.retailerListing.count({ where: { retailer: { domain: 'uk.bookshop.org' }, isbn13: { not: null }, deletedAt: null } })
const bkStubsPriced   = await prisma.retailerListing.count({ where: { retailer: { domain: 'uk.bookshop.org' }, priceAmount: { gt: 0 }, deletedAt: null } })

const sampleStubs = await prisma.retailerListing.findMany({
  where: { retailer: { domain: 'uk.bookshop.org' }, isbn13: { not: null }, deletedAt: null },
  select: { isbn13: true, priceAmount: true },
  take: 5,
})

console.log('Bookshop retailer:', bks ? `FOUND id=${bks.id.slice(0,8)} platform=${bks.platform}` : 'NOT FOUND')
console.log('LBB retailer:', lbb ? `FOUND id=${lbb.id.slice(0,8)} platform=${lbb.platform}` : 'NOT FOUND')
console.log('Bookshop stubs total:', bkStubsTotal)
console.log('Bookshop stubs with isbn13:', bkStubsWithIsbn)
console.log('Bookshop stubs priced (>0):', bkStubsPriced)
console.log('Sample ISBNs:', JSON.stringify(sampleStubs.map(s => ({ isbn: s.isbn13, price: s.priceAmount.toString() }))))

await prisma.$disconnect()
}
main().catch(console.error)
