/**
 * check-sync-due.ts — READ-ONLY. Would the hourly scheduler enqueue each
 * retailer right now?
 *
 * This imports the REAL decision function, lib/sync/dispatch.ts
 * isDueForScheduledSync, and feeds it the same fields the cron reads. It is
 * not a re-implementation of the rule, because a re-implementation would
 * agree with itself and prove nothing.
 *
 * Being "due" is registration, not execution. A retailer shown as due here has
 * still never been synced by the hosted job until a sync_logs row says so.
 *
 *   npx dotenv -e <main>/.env.local -- npx tsx scripts/check-sync-due.ts
 */
import { PrismaClient } from '@prisma/client'
import { isDueForScheduledSync, SKIP_PLATFORMS, isScheduledSyncDisabled } from '@/lib/sync/dispatch'

const prisma = new PrismaClient()

async function main() {
  const rows = await prisma.$queryRaw<Array<{
    domain: string; platform: string; lastSyncedAt: Date | null; syncConfig: unknown
    lastAttemptAt: Date | null; lastAttemptStatus: string | null; consecutiveFailures: number
  }>>`
    SELECT r.domain, r.platform::text AS "platform", r.last_synced_at AS "lastSyncedAt",
           r.sync_config AS "syncConfig",
           la.started_at AS "lastAttemptAt", la.status AS "lastAttemptStatus",
           COALESCE(cf.n, 0)::int AS "consecutiveFailures"
    FROM retailers r
    LEFT JOIN LATERAL (
      SELECT s.started_at, s.status FROM sync_logs s
      WHERE s.retailer_id = r.id ORDER BY s.started_at DESC LIMIT 1
    ) la ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS n FROM sync_logs s
      WHERE s.retailer_id = r.id AND s.status = 'error'
        AND s.started_at > COALESCE(r.last_synced_at, '1970-01-01'::timestamp)
    ) cf ON true
    WHERE r.is_active = true
    ORDER BY r.domain`

  const now = Date.now()
  console.log(`scheduler decision at ${new Date(now).toISOString()}\n`)
  for (const r of rows) {
    const due = isDueForScheduledSync(r as never, now)
    const why = SKIP_PLATFORMS.has(r.platform) ? `platform ${r.platform} is skipped`
      : isScheduledSyncDisabled(r.syncConfig) ? 'scheduled_sync_disabled=true'
      : due ? 'DUE — the next hourly tick will enqueue it'
      : 'not yet due (within its refresh interval, or backing off after failures)'
    console.log(`  ${due ? 'DUE    ' : 'skip   '} ${r.domain.padEnd(24)} ${r.platform.padEnd(17)} last synced ${r.lastSyncedAt?.toISOString().slice(0, 16).replace('T', ' ') ?? 'never'} · ${why}`)
  }
  console.log('\nBeing due is registration. Execution is a sync_logs row with status=success.')
  await prisma.$disconnect()
}

main().catch(async e => { await prisma.$disconnect(); console.error(e); process.exit(1) })
