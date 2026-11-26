/**
 * show-retailer-offers.ts — READ-ONLY. What a shopper can currently see from
 * one retailer, with the public URL for each.
 *
 *   npx dotenv -e <main>/.env.local -- npx tsx scripts/show-retailer-offers.ts waterstones.com 10
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const domain = process.argv[2]
const limit  = Number(process.argv[3] ?? 10)

async function main() {
  if (!domain) { console.error('usage: show-retailer-offers.ts <domain> [limit]'); process.exit(1) }

  const rows = await prisma.$queryRaw<{
    listing_id: string; slug: string; title: string; price: string; stock: string;
    condition: string; last_seen: Date; others: bigint
  }[]>`
    SELECT rl.id::text AS listing_id, cp.canonical_slug AS slug, cp.title,
           rl.price_amount::text AS price, rl.stock_status::text AS stock,
           rl.condition::text AS condition, rl.last_seen_at AS last_seen,
           (SELECT COUNT(DISTINCT o.retailer_id) FROM retailer_listings o
             WHERE o.canonical_product_id = rl.canonical_product_id
               AND o.deleted_at IS NULL AND o.price_amount > 0
               AND o.retailer_id <> rl.retailer_id)::bigint AS others
    FROM retailer_listings rl
    JOIN retailers r           ON r.id  = rl.retailer_id
    JOIN canonical_products cp ON cp.id = rl.canonical_product_id
    WHERE r.domain = ${domain} AND rl.deleted_at IS NULL AND rl.price_amount > 0
    ORDER BY (SELECT COUNT(DISTINCT o.retailer_id) FROM retailer_listings o
                WHERE o.canonical_product_id = rl.canonical_product_id
                  AND o.deleted_at IS NULL AND o.price_amount > 0
                  AND o.retailer_id <> rl.retailer_id) DESC,
             rl.price_amount DESC
    LIMIT ${limit}`

  console.log(`${rows.length} live priced offer(s) for ${domain}, most-compared first\n`)
  for (const r of rows) {
    console.log(`£${String(r.price).padStart(7)}  ${r.stock.padEnd(10)} ${r.condition.padEnd(9)} +${Number(r.others)} other retailer(s)  seen ${r.last_seen.toISOString().slice(0, 16).replace('T', ' ')}`)
    console.log(`          ${r.title.slice(0, 70)}`)
    console.log(`          https://www.catchcomics.com/product/${r.slug}`)
    console.log(`          listing ${r.listing_id}`)
  }
  await prisma.$disconnect()
}

main().catch(async e => { await prisma.$disconnect(); console.error(e); process.exit(1) })
