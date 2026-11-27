/**
 * retailer-health.ts — READ-ONLY. One row per retailer answering the only
 * question that matters operationally: is this source still working, and if
 * not, which kind of not-working is it?
 *
 * The 2026-09/10 outage was invisible because "nothing was due", "feed checked
 * and unchanged", "deliberately excluded" and "silently broken" all looked
 * identical from the outside — a retailer with no recent write. They are
 * different diagnoses with different responses, so they are kept distinct.
 *
 * The evaluation itself lives in lib/monitoring/retailer-health.ts and is
 * shared with POST /api/monitor/retailers. A dashboard that computed health
 * differently from the alarm would disagree with it exactly when something is
 * wrong, which is the worst possible moment.
 *
 * Also writes launch/operations/retailer-health-latest.json for the Command
 * Centre.
 *
 * STRICTLY READ-ONLY. Run: npm run retailers:health
 */

import { PrismaClient } from '@prisma/client'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  evaluateRetailerHealth, detectIncidents,
  STALE_HOURS, SCHEDULER_JOB, MONITOR_JOB,
} from '@/lib/monitoring/retailer-health'

const prisma = new PrismaClient()

const iso = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 16).replace('T', ' ') : '—'

async function main() {
  const now = new Date()
  const health = await evaluateRetailerHealth(prisma, now)

  console.log('\n## Retailer health — what each source is actually doing\n')
  console.log('   retailer              state        priced  last source check  last observation   next due          earliest expiry')
  for (const h of health) {
    console.log(
      '   ' + h.domain.padEnd(21) + h.state.padEnd(13) +
      String(h.priced).padStart(6) + '  ' +
      iso(h.lastCheck).padEnd(18) + iso(h.lastObservation).padEnd(18) +
      (h.state === 'BLOCKED' ? 'manual/CLI' : h.state === 'LIVE_LOOKUP' ? 'per request' : iso(h.nextDue)).padEnd(18) +
      iso(h.expiry),
    )
    if (h.note) console.log(`        └─ ${h.note}`)
  }

  const faults = health.filter(h => h.fault)
  const deliberate = health.filter(h => h.state === 'BLOCKED' || h.state === 'LIVE_LOOKUP')
  console.log(`\n   healthy: ${health.length - faults.length - deliberate.length} · deliberate: ${deliberate.length} · NEEDS ATTENTION: ${faults.length}`)
  for (const f of faults) console.log(`     ${f.state}  ${f.domain} — last observation ${iso(f.lastObservation)}`)

  // What the independent monitor would say right now, using the same code it
  // uses in production — so this report and the alarm never disagree.
  const [tick, previous] = await Promise.all([
    prisma.jobRun.findFirst({ where: { jobName: SCHEDULER_JOB }, orderBy: { startedAt: 'desc' }, select: { startedAt: true } }),
    prisma.jobRun.findFirst({ where: { jobName: MONITOR_JOB }, orderBy: { startedAt: 'desc' }, select: { metadata: true } }),
  ])
  const prevMeta = (previous?.metadata ?? {}) as { totalPriced?: unknown }
  const incidents = detectIncidents(health, {
    lastSchedulerTick: tick?.startedAt ?? null,
    previousPriced: typeof prevMeta.totalPriced === 'number' ? prevMeta.totalPriced : null,
  }, now)

  console.log(`\n## What the independent monitor would report: ${incidents.length === 0 ? 'nothing — all quiet' : `${incidents.length} open incident(s)`}\n`)
  for (const i of incidents) {
    console.log(`  [${i.severity}] ${i.title}`)
    for (const d of i.details) console.log(`      • ${d}`)
    console.log(`      → ${i.action}\n`)
  }

  const outDir = join(process.cwd(), 'launch', 'operations')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(
    join(outDir, 'retailer-health-latest.json'),
    JSON.stringify({
      generatedAt: now.toISOString(),
      staleHours: STALE_HOURS,
      openIncidents: incidents.map(i => ({ key: i.key, severity: i.severity, title: i.title })),
      retailers: health.map(h => ({
        domain: h.domain, platform: h.platform, state: h.state,
        priced: String(h.priced),
        check:  iso(h.lastCheck),
        obs:    iso(h.lastObservation),
        due:    h.state === 'BLOCKED' ? 'manual/CLI' : h.state === 'LIVE_LOOKUP' ? 'per request' : iso(h.nextDue),
        expiry: iso(h.expiry),
        note:   h.note,
      })),
    }, null, 2) + '\n',
    'utf8',
  )

  await prisma.$disconnect()
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
