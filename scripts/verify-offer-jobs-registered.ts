/**
 * verify-offer-jobs-registered.ts — prove the two B4 jobs are wired up.
 *
 * Checks, locally and without network:
 *   1. the barrel exports them;
 *   2. app/api/inngest/route.ts passes them to serve() — without that they are
 *      dead code, whatever the cron says;
 *   3. each carries the id and cron this fix depends on, and the refresh runs
 *      BEFORE cleanup-stale's 03:00 sweep.
 *
 * This proves REGISTRATION ONLY. It cannot prove a cron has fired — that needs
 * a deployed app and an observed run in the Inngest dashboard, and until then
 * offer_health.check deliberately raises offer-refresh-never-succeeded.
 *
 *   npx tsx scripts/verify-offer-jobs-registered.ts
 */
import { readFileSync } from 'node:fs'
import { join }         from 'node:path'
import { offerRefresh, offerHealthCheck } from '@/lib/inngest'

let failures = 0
const check = (ok: boolean, label: string, detail: string) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`)
  if (!ok) failures++
}

/** cleanup-stale's cron hour, which the refresh must precede. */
const SWEEP_HOUR = 3

function cronOf(fn: unknown): string | null {
  // Inngest keeps the trigger list on the function definition; read it
  // defensively so a library shape change fails loudly here rather than
  // silently in production.
  const triggers = (fn as { opts?: { triggers?: { cron?: string }[] } }).opts?.triggers
    ?? (fn as { triggers?: { cron?: string }[] }).triggers
  if (!Array.isArray(triggers)) return null
  return triggers.find(t => typeof t?.cron === 'string')?.cron ?? null
}

function idOf(fn: unknown): string | null {
  const o = fn as { id?: unknown; opts?: { id?: string } }
  if (typeof o.id === 'string') return o.id
  if (typeof o.id === 'function') return (o.id as () => string)()
  return o.opts?.id ?? null
}

console.log('── 1. exported from the barrel ──')
check(offerRefresh !== undefined, 'offerRefresh exported', typeof offerRefresh)
check(offerHealthCheck !== undefined, 'offerHealthCheck exported', typeof offerHealthCheck)

console.log('\n── 2. passed to serve() in the route ──')
const route = readFileSync(join(process.cwd(), 'app', 'api', 'inngest', 'route.ts'), 'utf8')
const fnArray = route.slice(route.indexOf('functions:'))
check(fnArray.includes('offerRefresh'), 'offerRefresh in the functions array', 'app/api/inngest/route.ts')
check(fnArray.includes('offerHealthCheck'), 'offerHealthCheck in the functions array', 'app/api/inngest/route.ts')

console.log('\n── 3. ids and crons ──')
const refreshId   = idOf(offerRefresh)
const healthId    = idOf(offerHealthCheck)
const refreshCron = cronOf(offerRefresh)
const healthCron  = cronOf(offerHealthCheck)

check(refreshId === 'offer-refresh-verified-offers', 'refresh id', String(refreshId))
check(healthId === 'offer-health-check', 'health id', String(healthId))
check(refreshCron !== null, 'refresh has a cron trigger', String(refreshCron))
check(healthCron !== null, 'health has a cron trigger', String(healthCron))

if (refreshCron) {
  const hour = Number(refreshCron.split(/\s+/)[1])
  check(
    Number.isFinite(hour) && hour < SWEEP_HOUR,
    'refresh runs before the 03:00 retention sweep',
    `refresh at ${hour}:00 UTC vs sweep at ${SWEEP_HOUR}:00 UTC`,
  )
}
if (healthCron && refreshCron) {
  const h = Number(healthCron.split(/\s+/)[1])
  check(
    Number.isFinite(h) && h > SWEEP_HOUR,
    'health check runs after the sweep, so it sees the real state',
    `health at ${h}:00 UTC`,
  )
}

console.log(`\n${failures === 0 ? 'REGISTERED — but no cron run observed yet' : `${failures} CHECK(S) FAILED`}`)
if (failures > 0) process.exit(1)
