/**
 * awin-leak-scan.ts — READ-ONLY. Looks for the Awin datafeed key in anything
 * we have stored, and reports WHERE without ever displaying it.
 *
 * Two independent searches, because they fail differently:
 *   1. the exact current key, passed as a bound SQL parameter so it never
 *      appears in a query string, a log line or this script's output;
 *   2. the URL shape `/apikey/<something>`, which catches a ROTATED key, a
 *      per-retailer sync_config key, and any key we no longer hold.
 *
 * Matched text is never printed. Only table, column, row count, row ids and
 * timestamps are reported.
 *
 *   npx dotenv -e <main>/.env.local -- npx tsx scripts/awin-leak-scan.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const KEY = process.env.AWIN_DATAFEED_KEY ?? null

let findings = 0

function report(label: string, rows: { id?: string; when?: Date | null }[], detail = '') {
  if (rows.length === 0) { console.log(`  clean   ${label}`); return }
  findings += rows.length
  console.log(`  EXPOSED ${label} — ${rows.length} row(s) ${detail}`)
  for (const r of rows.slice(0, 10)) {
    console.log(`            id ${r.id ?? '?'}${r.when ? ` · ${r.when.toISOString()}` : ''}`)
  }
  if (rows.length > 10) console.log(`            … and ${rows.length - 10} more`)
}

async function main() {
  console.log('# Awin datafeed key — exposure scan')
  console.log(`run ${new Date().toISOString()} · READ-ONLY · the key is never printed\n`)
  console.log(`AWIN_DATAFEED_KEY present in env: ${KEY ? 'yes' : 'no'}`)
  console.log(`exact-key search: ${KEY ? 'enabled' : 'SKIPPED (no key to compare against)'}\n`)

  // ── 1. Exact current key, bound as a parameter ───────────────────────────
  if (KEY) {
    console.log('## Exact current key\n')

    const syncLogs = await prisma.$queryRaw<{ id: string; started_at: Date }[]>`
      SELECT id::text, started_at FROM sync_logs
      WHERE error_summary IS NOT NULL AND position(${KEY} in error_summary) > 0
      ORDER BY started_at DESC`
    report('sync_logs.error_summary', syncLogs.map(r => ({ id: r.id, when: r.started_at })))

    const jobErr = await prisma.$queryRaw<{ id: string; started_at: Date }[]>`
      SELECT id::text, started_at FROM job_runs
      WHERE error_summary IS NOT NULL AND position(${KEY} in error_summary) > 0
      ORDER BY started_at DESC`
    report('job_runs.error_summary', jobErr.map(r => ({ id: r.id, when: r.started_at })))

    const jobMeta = await prisma.$queryRaw<{ id: string; started_at: Date }[]>`
      SELECT id::text, started_at FROM job_runs
      WHERE position(${KEY} in metadata::text) > 0
      ORDER BY started_at DESC`
    report('job_runs.metadata', jobMeta.map(r => ({ id: r.id, when: r.started_at })))

    const listings = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM retailer_listings
      WHERE position(${KEY} in retailer_url) > 0 LIMIT 50`
    report('retailer_listings.retailer_url', listings.map(r => ({ id: r.id })))

    const cfg = await prisma.$queryRaw<{ id: string; domain: string }[]>`
      SELECT id::text, domain FROM retailers
      WHERE position(${KEY} in sync_config::text) > 0`
    if (cfg.length === 0) console.log('  clean   retailers.sync_config (the env key is not duplicated per retailer)')
    else {
      // This one is storage by design, not a leak — but it is worth knowing,
      // because rotating the env var alone would leave these stale.
      console.log(`  NOTE    retailers.sync_config holds the same key for ${cfg.length} retailer(s): ${cfg.map(c => c.domain).join(', ')}`)
      console.log('            that is the adapter\'s documented per-retailer override, not a leak,')
      console.log('            but a rotation must update these rows too or those feeds will break.')
    }
  }

  // ── 2. URL shape — catches rotated and per-retailer keys ─────────────────
  console.log('\n## Any `/apikey/<value>` URL, including keys we no longer hold\n')

  const shapeSync = await prisma.$queryRaw<{ id: string; started_at: Date }[]>`
    SELECT id::text, started_at FROM sync_logs
    WHERE error_summary ~ '/apikey/[^/\\s]+' ORDER BY started_at DESC`
  report('sync_logs.error_summary', shapeSync.map(r => ({ id: r.id, when: r.started_at })), '(URL shape)')

  const shapeJob = await prisma.$queryRaw<{ id: string; started_at: Date }[]>`
    SELECT id::text, started_at FROM job_runs
    WHERE COALESCE(error_summary, '') ~ '/apikey/[^/\\s]+'
       OR metadata::text ~ '/apikey/[^/\\s]+' ORDER BY started_at DESC`
  report('job_runs (error_summary or metadata)', shapeJob.map(r => ({ id: r.id, when: r.started_at })), '(URL shape)')

  const shapeListing = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id::text FROM retailer_listings
    WHERE retailer_url ~ '/apikey/[^/\\s]+' LIMIT 50`
  report('retailer_listings.retailer_url', shapeListing.map(r => ({ id: r.id })), '(URL shape)')

  const shapeCfg = await prisma.$queryRaw<{ domain: string }[]>`
    SELECT domain FROM retailers WHERE sync_config::text ~ '/apikey/[^/\\s]+'`
  if (shapeCfg.length) {
    findings += shapeCfg.length
    console.log(`  EXPOSED retailers.sync_config holds a tokenised URL for: ${shapeCfg.map(c => c.domain).join(', ')}`)
  } else {
    console.log('  clean   retailers.sync_config (no tokenised feed URLs stored)')
  }

  // ── 3. How far could it have travelled? ──────────────────────────────────
  console.log('\n## Blast radius\n')
  const [awinSyncs] = await prisma.$queryRaw<{ c: bigint; failed: bigint; last: Date | null }[]>`
    SELECT COUNT(*)::bigint AS c,
           COUNT(*) FILTER (WHERE sl.status = 'error')::bigint AS failed,
           MAX(sl.started_at) AS last
    FROM sync_logs sl JOIN retailers r ON r.id = sl.retailer_id
    WHERE r.platform = 'AWIN_FEED'`
  console.log(`  sync_logs rows for AWIN_FEED retailers: ${Number(awinSyncs.c)} · of those status=error: ${Number(awinSyncs.failed)} · most recent ${awinSyncs.last?.toISOString() ?? '—'}`)
  console.log('  Only a FAILED download could have written the URL, so an error count of 0 means')
  console.log('  the leak path existed but was never taken.')

  console.log(`\n${findings === 0 ? 'NO EXPOSURE FOUND in stored data.' : `${findings} EXPOSED ROW(S) — rotate the key.`}`)

  await prisma.$disconnect()
  if (findings > 0) process.exitCode = 2
}

main().catch(async e => {
  await prisma.$disconnect()
  // Redact defensively: an error here could itself carry the key.
  const msg = e instanceof Error ? (e.stack ?? e.message) : String(e)
  console.error(KEY ? msg.split(KEY).join('<AWIN_DATAFEED_KEY>') : msg)
  process.exit(1)
})
