/**
 * disable-tm-scheduled-sync.ts — containment for Travelling Man (2026-08-23).
 *
 * Sets syncConfig.scheduled_sync_disabled = true on the Travelling Man
 * retailer row ONLY. Both the hourly scheduler (isDueForScheduledSync) and
 * dispatchSync honour the flag, so the adapter path can no longer refresh,
 * revive, or create listings for this retailer if the paused Inngest schedule
 * is ever resumed.
 *
 * Why Travelling Man specifically: its catalogue is 37,782 products, while the
 * legacy /products.json route it would use tops out at 25,000 (page 100 x 250).
 * A scheduled sync therefore can NEVER prove completion — which is exactly the
 * "never completes, so it is always due" condition behind the 2026-08-09
 * Inngest quota incident. The bounded CLI refresh is the only safe path:
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/price-verify-dryrun.ts --write --max-rows 2300
 *
 * The spread preserves TM's existing config (comic_filter: true,
 * prev_missing_skus, and anything else). Idempotent: re-running reports the
 * current state and changes nothing new. Reverting is the same edit with false
 * (a founder decision — see lib/sync/dispatch.ts).
 *
 * Run: npx dotenv -e .env.local -- npx tsx scripts/disable-tm-scheduled-sync.ts
 */

import { PrismaClient, Prisma } from '@prisma/client'

const prisma = new PrismaClient()
const DOMAIN = 'travellingman.com'

async function main() {
  const retailer = await prisma.retailer.findFirst({
    where:  { domain: DOMAIN },
    select: { id: true, name: true, syncConfig: true },
  })
  if (!retailer) throw new Error(`Retailer ${DOMAIN} not found`)

  const cfg = (retailer.syncConfig ?? {}) as Record<string, unknown>
  const keysBefore = Object.keys(cfg).sort()
  console.log(`Before: ${retailer.name} syncConfig keys = [${keysBefore.join(', ')}]`)
  console.log(`        comic_filter=${JSON.stringify(cfg.comic_filter)} · prev_missing_skus=${(cfg.prev_missing_skus as unknown[] | undefined)?.length ?? 0} SKUs · scheduled_sync_disabled=${JSON.stringify(cfg.scheduled_sync_disabled ?? null)}`)

  if (cfg.scheduled_sync_disabled === true) {
    console.log('Already disabled — nothing to do.')
    return
  }

  const updated = await prisma.retailer.update({
    where:  { id: retailer.id },
    data:   { syncConfig: { ...cfg, scheduled_sync_disabled: true } as Prisma.InputJsonValue },
    select: { syncConfig: true },
  })

  // Verify the stored value and that nothing else was lost.
  const after = (updated.syncConfig ?? {}) as Record<string, unknown>
  const keysAfter = Object.keys(after).sort()
  console.log(`After:  syncConfig keys = [${keysAfter.join(', ')}]`)
  console.log(`        comic_filter=${JSON.stringify(after.comic_filter)} · prev_missing_skus=${(after.prev_missing_skus as unknown[] | undefined)?.length ?? 0} SKUs · scheduled_sync_disabled=${JSON.stringify(after.scheduled_sync_disabled)}`)

  const preserved = keysBefore.every(k => keysAfter.includes(k))
  if (!preserved || after.scheduled_sync_disabled !== true) {
    throw new Error('Config verification FAILED — key loss or flag not set. Investigate before proceeding.')
  }
  console.log('Scheduled/adapter sync DISABLED for Travelling Man. Existing config preserved. Bounded CLI refresh unaffected.')
}

main()
  .catch(err => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())
