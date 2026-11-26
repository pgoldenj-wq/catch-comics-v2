/**
 * check-deletion-cohorts.ts — READ-ONLY. Shows how a retailer's soft-deleted
 * rows are distributed, split by whether the deletion looks automated.
 *
 * cleanup-stale runs `0 3 * * *`, so an automated expiry carries a 03:xx UTC
 * timestamp. Anything else is presumed a deliberate suppression, and the Awin
 * adapter will no longer revive those rows on a feed sync.
 *
 *   npx dotenv -e <main>/.env.local -- npx tsx scripts/check-deletion-cohorts.ts waterstones.com
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const domain = process.argv[2]

async function main() {
  if (!domain) { console.error('usage: check-deletion-cohorts.ts <domain>'); process.exit(1) }

  const rows = await prisma.$queryRaw<{ at: Date; n: bigint; automated: boolean }[]>`
    SELECT rl.deleted_at AS at, COUNT(*)::bigint AS n,
           (EXTRACT(HOUR FROM rl.deleted_at AT TIME ZONE 'UTC') * 60
            + EXTRACT(MINUTE FROM rl.deleted_at AT TIME ZONE 'UTC')) BETWEEN 180 AND 241 AS automated
    FROM retailer_listings rl JOIN retailers r ON r.id = rl.retailer_id
    WHERE r.domain = ${domain} AND rl.deleted_at IS NOT NULL
    GROUP BY rl.deleted_at ORDER BY COUNT(*) DESC LIMIT 20`

  const [tot] = await prisma.$queryRaw<{ total: bigint; auto: bigint; manual: bigint }[]>`
    SELECT COUNT(*)::bigint AS total,
           COUNT(*) FILTER (WHERE (EXTRACT(HOUR FROM rl.deleted_at AT TIME ZONE 'UTC') * 60
                  + EXTRACT(MINUTE FROM rl.deleted_at AT TIME ZONE 'UTC')) BETWEEN 180 AND 241)::bigint AS auto,
           COUNT(*) FILTER (WHERE NOT ((EXTRACT(HOUR FROM rl.deleted_at AT TIME ZONE 'UTC') * 60
                  + EXTRACT(MINUTE FROM rl.deleted_at AT TIME ZONE 'UTC')) BETWEEN 180 AND 241))::bigint AS manual
    FROM retailer_listings rl JOIN retailers r ON r.id = rl.retailer_id
    WHERE r.domain = ${domain} AND rl.deleted_at IS NOT NULL`

  console.log(`${domain}: ${Number(tot.total).toLocaleString()} soft-deleted rows`)
  console.log(`  automated (03:00-04:01 UTC), revivable by a feed : ${Number(tot.auto).toLocaleString()}`)
  console.log(`  outside that window, PROTECTED from revival      : ${Number(tot.manual).toLocaleString()}`)
  console.log('\n  largest cohorts:')
  for (const r of rows) {
    console.log(`    ${r.automated ? 'automated' : 'PROTECTED'}  ${r.at.toISOString()}  ×${Number(r.n).toLocaleString()}`)
  }
  await prisma.$disconnect()
}

main().catch(async e => { await prisma.$disconnect(); console.error(e); process.exit(1) })
