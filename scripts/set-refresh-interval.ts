/**
 * set-refresh-interval.ts — set sync_config.refreshIntervalHours on one
 * retailer. Reads it back and prints the scheduler's resulting decision.
 *
 * Used to bring a small feed forward so a HOSTED run can actually be observed
 * tonight rather than asserted from the schedule. Put the interval back
 * afterwards: a 1-hour interval on a large feed means 24 full downloads a day.
 *
 *   npx dotenv -e <main>/.env.local -- npx tsx scripts/set-refresh-interval.ts scholastic.co.uk 1
 */
import { PrismaClient, Prisma } from '@prisma/client'

const prisma = new PrismaClient()
const domain = process.argv[2]
const hours  = Number(process.argv[3])

async function main() {
  if (!domain || !Number.isFinite(hours) || hours < 1) {
    console.error('usage: set-refresh-interval.ts <domain> <hours>'); process.exit(1)
  }
  const r = await prisma.retailer.findUniqueOrThrow({ where: { domain } })
  const cfg = { ...(r.syncConfig as Record<string, unknown> ?? {}) }
  const before = cfg.refreshIntervalHours ?? '(default for platform)'
  cfg.refreshIntervalHours = hours

  await prisma.retailer.update({
    where: { id: r.id },
    data : { syncConfig: cfg as Prisma.InputJsonValue },
  })

  const lastSynced = r.lastSyncedAt
  const nextDue = lastSynced ? new Date(lastSynced.getTime() + hours * 3_600_000) : new Date()
  console.log(`${domain}: refreshIntervalHours ${before} -> ${hours}`)
  console.log(`  last synced ${lastSynced?.toISOString() ?? 'never'}`)
  console.log(`  due from    ${nextDue.toISOString()}${nextDue.getTime() <= Date.now() ? '  (already due — the next hourly tick will enqueue it)' : ''}`)
  await prisma.$disconnect()
}

main().catch(async e => { await prisma.$disconnect(); console.error(e); process.exit(1) })
