/**
 * disable-lbb-scheduled-sync.ts — containment for the ungated hourly LBB sync
 * (2026-07-16).
 *
 * Sets syncConfig.scheduled_sync_disabled = true on the Lets Buy Books
 * retailer row ONLY. Both the hourly scheduler (isDueForScheduledSync) and
 * dispatchSync honour the flag, so the ungated awin-feed adapter can no
 * longer refresh, revive, or create listings for this retailer. The gated
 * CLI sync is unaffected and remains the only LBB refresh path:
 *
 *   npm run sync:awin -- --merchant letsbuybooks --no-create --comics-only --write
 *
 * Idempotent: re-running reports the current state and changes nothing new.
 * Reverting is the same edit with false (a founder decision — see
 * lib/sync/dispatch.ts for why the adapter path is unsafe for this feed).
 *
 * Run: npx dotenv-cli -e .env.local -- npx tsx scripts/disable-lbb-scheduled-sync.ts
 */

import { PrismaClient, Prisma } from '@prisma/client'

const prisma = new PrismaClient()
const DOMAIN = 'letsbuybooks.com'

async function main() {
  const retailer = await prisma.retailer.findFirst({
    where:  { domain: DOMAIN },
    select: { id: true, name: true, syncConfig: true },
  })
  if (!retailer) throw new Error(`Retailer ${DOMAIN} not found`)

  const cfg = (retailer.syncConfig ?? {}) as Record<string, unknown>
  console.log(`Before: ${retailer.name} syncConfig = ${JSON.stringify(cfg)}`)

  if (cfg.scheduled_sync_disabled === true) {
    console.log('Already disabled — nothing to do.')
    return
  }

  const updated = await prisma.retailer.update({
    where: { id: retailer.id },
    data:  { syncConfig: { ...cfg, scheduled_sync_disabled: true } as Prisma.InputJsonValue },
    select: { syncConfig: true },
  })
  console.log(`After:  ${retailer.name} syncConfig = ${JSON.stringify(updated.syncConfig)}`)
  console.log('Scheduled/adapter sync DISABLED for Lets Buy Books. Gated CLI sync unaffected.')
}

main()
  .catch(err => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())
