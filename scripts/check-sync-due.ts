/**
 * check-sync-due.ts — READ-ONLY. Would the hourly scheduler enqueue each
 * retailer right now?
 *
 * This imports the REAL decision function, lib/sync/dispatch.ts
 * isDueForScheduledSync, and feeds it the same fields the cron reads. It is
 * not a re-implementation of the rule, because a re-implementation would
 * agree with itself and prove nothing.
 *
 * Importing the predicate is not enough on its own, though — it has to be fed
 * the same INPUTS. As first written (2026-11-26) this counted
 * `consecutiveFailures` as sync_logs rows at status='error', where the cron
 * counts EVERY attempt since the last success. On the three Awin feeds both
 * counts were 0, so the two agreed and the gap stayed hidden; on
 * worldofbooks.com they are 1,634 and 36, i.e. a 24 h cooldown versus a 16 h
 * one. The lateral joins below are now copied from
 * lib/inngest/functions/sync-scheduled.ts verbatim. Keep them that way.
 *
 * Being "due" is registration, not execution. A retailer shown as due here has
 * still never been synced by the hosted job until a sync_logs row says so —
 * and on 2026-11-27 that distinction was the whole finding: scholastic.co.uk
 * read DUE here while the hosted cron had not executed since 2026-08-09.
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
      WHERE s.retailer_id = r.id
        AND s.started_at > COALESCE(r.last_synced_at, '-infinity'::timestamptz)
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
