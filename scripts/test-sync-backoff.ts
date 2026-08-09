/**
 * test-sync-backoff.ts — proves the 2026-08-09 Inngest quota fix holds.
 *
 * The incident: retailers whose sync never COMPLETED stayed permanently "due"
 * (lastSyncedAt only advances on success; null reads as epoch), so the hourly
 * cron re-enqueued them 24x/day forever. Each partial ingest created products,
 * and every new product fired one ungated `bookshop/lookup` event — ~55,000
 * executions in 30 days, ~68% of the monthly Hobby allowance.
 *
 * Run: npm run test:sync-backoff   (pure functions — no DB, no network)
 */

import {
  isDueForScheduledSync,
  failureCooldownMs,
  refreshIntervalHours,
  SKIP_PLATFORMS,
  RUN_LEASE_MS,
  FAILURE_COOLDOWN_MAX_MS,
} from '../lib/sync/dispatch'
import {
  withFanoutBudget,
  claimFanoutSlot,
  fanoutSuppressionNotice,
} from '../lib/adapters/shared/fanout'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`✓ ${label}`)
  else { failures++; console.error(`✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

const NOW = Date.now()
const hoursAgo = (h: number) => new Date(NOW - h * 60 * 60 * 1000)
const minsAgo  = (m: number) => new Date(NOW - m * 60 * 1000)

// ── 1. A failed retailer is NOT re-enqueued on the next hourly tick ──────────
// This is worldofbooks.com's exact shape: SHOPIFY (6h interval), last success
// two months ago, latest attempt timed out an hour ago, hundreds of failures.
const worldOfBooks = {
  platform: 'SHOPIFY',
  lastSyncedAt: hoursAgo(24 * 67),
  syncConfig: {},
  lastAttemptAt: minsAgo(59),
  lastAttemptStatus: 'running',
  consecutiveFailures: 699,
}
check('BUG FIXED: failing retailer not due 59 min after a failed attempt',
  isDueForScheduledSync(worldOfBooks, NOW) === false)
check('failing retailer still not due 5 h later (24 h cap)',
  isDueForScheduledSync({ ...worldOfBooks, lastAttemptAt: hoursAgo(5) }, NOW) === false)
check('failing retailer still not due 23 h later',
  isDueForScheduledSync({ ...worldOfBooks, lastAttemptAt: hoursAgo(23) }, NOW) === false)
check('failing retailer IS due again after the 24 h cap — backoff, not a ban',
  isDueForScheduledSync({ ...worldOfBooks, lastAttemptAt: hoursAgo(25) }, NOW) === true)

// Regression guard on the old behaviour: without attempt state the predicate
// must still work (existing callers / test-lbb-containment.ts).
check('legacy shape (no attempt state) still due on interval alone',
  isDueForScheduledSync({ platform: 'SHOPIFY', lastSyncedAt: hoursAgo(7), syncConfig: {} }, NOW) === true)

// amazon.co.uk's shape: lastSyncedAt null → epoch → "due" forever, 701 runs.
const amazonShaped = {
  platform: 'AWIN_FEED',
  lastSyncedAt: null,
  syncConfig: {},
  lastAttemptAt: minsAgo(61),
  lastAttemptStatus: 'running',
  consecutiveFailures: 701,
}
check('never-synced-but-always-failing retailer is not due (the amazon.co.uk loop)',
  isDueForScheduledSync(amazonShaped, NOW) === false)
check('never-synced and never-ATTEMPTED retailer is still due (first run must happen)',
  isDueForScheduledSync({ platform: 'AWIN_FEED', lastSyncedAt: null, syncConfig: {} }, NOW) === true)

// ── 2. Backoff curve: doubles, then caps ─────────────────────────────────────
check('cooldown 0 failures = none',      failureCooldownMs(0) === 0)
check('cooldown 1 failure  = 1 h',       failureCooldownMs(1) === 3_600_000)
check('cooldown 2 failures = 2 h',       failureCooldownMs(2) === 7_200_000)
check('cooldown 3 failures = 4 h',       failureCooldownMs(3) === 14_400_000)
check('cooldown 5 failures = 16 h',      failureCooldownMs(5) === 57_600_000)
check('cooldown caps at 24 h',           failureCooldownMs(6) === FAILURE_COOLDOWN_MAX_MS)
check('cooldown still capped at 699 failures (no overflow to Infinity)',
  failureCooldownMs(699) === FAILURE_COOLDOWN_MAX_MS)

// A single transient failure must not impose the full 24 h penalty.
const transient = {
  platform: 'SHOPIFY', lastSyncedAt: hoursAgo(8), syncConfig: {},
  lastAttemptAt: hoursAgo(2), lastAttemptStatus: 'error', consecutiveFailures: 1,
}
check('one transient failure backs off 1 h only, then retries', isDueForScheduledSync(transient, NOW) === true)
check('...but not within that first hour',
  isDueForScheduledSync({ ...transient, lastAttemptAt: minsAgo(30) }, NOW) === false)

// ── 3. lastSyncedAt is SUCCESS-ONLY ──────────────────────────────────────────
// The predicate must never treat an attempt as a sync. A retailer that attempted
// 1 minute ago but last SUCCEEDED 7 h ago is due again once its cooldown clears.
const succeededThenWaited = {
  platform: 'SHOPIFY', lastSyncedAt: hoursAgo(7), syncConfig: {},
  lastAttemptAt: hoursAgo(7), lastAttemptStatus: 'success', consecutiveFailures: 0,
}
check('success advances the clock: due again after the 6 h interval',
  isDueForScheduledSync(succeededThenWaited, NOW) === true)
check('a successful attempt imposes NO cooldown (only the normal interval)',
  isDueForScheduledSync({ ...succeededThenWaited, lastSyncedAt: hoursAgo(2), lastAttemptAt: hoursAgo(2) }, NOW) === false)
check('recent success does not make a retailer due early',
  isDueForScheduledSync({ ...succeededThenWaited, lastSyncedAt: minsAgo(5), lastAttemptAt: minsAgo(5) }, NOW) === false)

// ── 4. Overlapping runs are prevented ────────────────────────────────────────
const inFlight = {
  platform: 'SHOPIFY', lastSyncedAt: hoursAgo(48), syncConfig: {},
  lastAttemptAt: minsAgo(5), lastAttemptStatus: 'running', consecutiveFailures: 0,
}
check('a run started 5 min ago holds the lease — no overlapping enqueue',
  isDueForScheduledSync(inFlight, NOW) === false)
check(`a 'running' row older than the ${RUN_LEASE_MS / 60000} min lease is treated as dead, not in-flight`,
  isDueForScheduledSync({ ...inFlight, lastAttemptAt: minsAgo(31), consecutiveFailures: 0 }, NOW) === true)

// ── 5. Disabled retailers are ignored by every automatic schedule ────────────
// scheduled-sync: via the predicate.
const disabled = {
  platform: 'AWIN_FEED', lastSyncedAt: hoursAgo(24 * 100),
  syncConfig: { scheduled_sync_disabled: true },
}
check('scheduled-sync ignores a disabled retailer, 100 days overdue',
  isDueForScheduledSync(disabled, NOW) === false)
check('scheduled-sync ignores a disabled retailer even with a clean attempt history',
  isDueForScheduledSync({ ...disabled, lastAttemptStatus: 'success', consecutiveFailures: 0 }, NOW) === false)

// price-check: via SQL. Assert the query text carries both exclusions, so the
// leak that let letsbuybooks.com run 5x/24h while disabled cannot silently return.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const priceCheckSrc = readFileSync(join(__dirname, '..', 'lib', 'inngest', 'functions', 'price-check.ts'), 'utf8')
check('price-check SQL excludes scheduled_sync_disabled retailers',
  priceCheckSrc.includes("(ret.sync_config->'scheduled_sync_disabled') IS DISTINCT FROM 'true'::jsonb"))
check('price-check SQL excludes SKIP_PLATFORMS (no-adapter platforms)',
  priceCheckSrc.includes('ret.platform::text <> ALL('))
check('price-check imports the single source of truth for SKIP_PLATFORMS',
  /import \{[^}]*\bSKIP_PLATFORMS\b[^}]*\}\s+from\s+'@\/lib\/sync\/dispatch'/.test(priceCheckSrc))

// ── 6. dispatchSync does not fetch the whole syncConfig blob ─────────────────
const schedSrcEarly = readFileSync(join(__dirname, '..', 'lib', 'inngest', 'functions', 'sync-scheduled.ts'), 'utf8')
const dispatchSrc = readFileSync(join(__dirname, '..', 'lib', 'sync', 'dispatch.ts'), 'utf8')
const dispatchBody = dispatchSrc.slice(dispatchSrc.indexOf('export async function dispatchSync'))
check('dispatchSync no longer does an unrestricted findUniqueOrThrow',
  !dispatchBody.includes('findUniqueOrThrow({ where: { id: retailerId } })'))
check('dispatchSync extracts only the disabled flag server-side',
  dispatchBody.includes("(sync_config->'scheduled_sync_disabled') = 'true'::jsonb"))
check('price-check casts the platform ENUM to text before comparing (prod-fatal otherwise)',
  priceCheckSrc.includes('ret.platform::text <> ALL('))
check('failure count is keyed off last_synced_at, not the unreliable log status',
  schedSrcEarly.includes('s.started_at > COALESCE(r.last_synced_at') &&
  !schedSrcEarly.includes("s.status <> 'success'"))
check('dispatchSync selects only domain + platform + the flag',
  /SELECT domain,\s*\n\s*platform,/.test(dispatchBody))

// A malformed flag must never raise a Postgres cast error that takes the whole
// scheduler down, and must never widen the flag's strict-boolean semantics.
check('no fragile ::boolean cast on the flag anywhere in the automatic paths',
  !dispatchBody.includes("'scheduled_sync_disabled')::boolean") &&
  !schedSrcEarly.includes("'scheduled_sync_disabled')::boolean") &&
  !priceCheckSrc.includes("'scheduled_sync_disabled')::boolean"))
check('refreshIntervalHours cast is type-guarded (jsonb_typeof = number)',
  schedSrcEarly.includes("jsonb_typeof(r.sync_config->'refreshIntervalHours') = 'number'"))

const schedSrc = readFileSync(join(__dirname, '..', 'lib', 'inngest', 'functions', 'sync-scheduled.ts'), 'utf8')
check('scheduled-sync no longer selects the syncConfig column wholesale',
  !schedSrc.includes('syncConfig:   true'))
check('scheduled-sync extracts refreshIntervalHours server-side',
  schedSrc.includes("(r.sync_config->>'refreshIntervalHours')::int"))
check('scheduled-sync reads attempt history from sync_logs (no migration)',
  schedSrc.includes('FROM sync_logs s') && schedSrc.includes('"consecutiveFailures"'))

// ── 7. Bookshop fan-out cannot exceed the ceiling ────────────────────────────
async function fanoutTests() {
  // Simulate a runaway ingest: 10,000 new products in one run, ceiling 500.
  const { budget } = await withFanoutBudget(async () => {
    let emitted = 0
    for (let i = 0; i < 10_000; i++) if (claimFanoutSlot('bookshop/lookup')) emitted++
    return emitted
  }, 500)

  check('runaway ingest emits exactly the ceiling, not 10,000', budget.emitted === 500)
  check('every excess event is counted as suppressed', budget.suppressed === 9_500)
  check('emitted + suppressed accounts for every product (no silent loss)',
    budget.emitted + budget.suppressed === 10_000)

  const notice = fanoutSuppressionNotice(budget)
  check('suppression is reported truthfully, not swallowed',
    notice !== null && notice.includes('9500') && notice.includes('500'))

  // A healthy run stays well inside budget and reports nothing.
  const healthy = await withFanoutBudget(async () => {
    for (let i = 0; i < 26; i++) claimFanoutSlot('bookshop/lookup')   // TM's biggest real day
    return null
  }, 500)
  check('a healthy incremental sync is unaffected by the ceiling', healthy.budget.emitted === 26)
  check('a healthy run reports no suppression', fanoutSuppressionNotice(healthy.budget) === null)

  // Concurrent runs must not spend each other's budget (concurrency: limit 5).
  const [a, b] = await Promise.all([
    withFanoutBudget(async () => { for (let i = 0; i < 400; i++) claimFanoutSlot('x') }, 500),
    withFanoutBudget(async () => { for (let i = 0; i < 400; i++) claimFanoutSlot('x') }, 500),
  ])
  check('concurrent runs hold independent budgets (AsyncLocalStorage scoping)',
    a.budget.emitted === 400 && b.budget.emitted === 400 &&
    a.budget.suppressed === 0 && b.budget.suppressed === 0)

  // Unscoped callers (CLI scripts, admin one-offs) are not blocked.
  check('outside a budget scope emission is unrestricted (CLI paths keep working)',
    claimFanoutSlot('bookshop/lookup') === true)
}

// ── 8. travellingman.com remains eligible when genuinely due ─────────────────
const travellingman = {
  platform: 'SHOPIFY', lastSyncedAt: hoursAgo(7), syncConfig: { comic_filter: true },
  lastAttemptAt: hoursAgo(7), lastAttemptStatus: 'success', consecutiveFailures: 0,
}
check('travellingman.com (healthy, 7 h since success) is still due',
  isDueForScheduledSync(travellingman, NOW) === true)
check('travellingman.com keeps its 6 h SHOPIFY interval',
  refreshIntervalHours({ comic_filter: true }, 'SHOPIFY') === 6)
check('travellingman.com not due 3 h after a successful sync',
  isDueForScheduledSync({ ...travellingman, lastSyncedAt: hoursAgo(3), lastAttemptAt: hoursAgo(3) }, NOW) === false)
check('travellingman.com recovers to the 6 h cadence once a sync succeeds',
  isDueForScheduledSync({
    ...travellingman, lastSyncedAt: hoursAgo(6), lastAttemptAt: hoursAgo(6),
    lastAttemptStatus: 'success', consecutiveFailures: 0,
  }, NOW) === true)

// The three contained retailers must stay contained.
for (const domain of ['worldofbooks.com', 'amazon.co.uk', 'scholastic.co.uk']) {
  check(`${domain} stays contained while scheduled_sync_disabled is set`,
    isDueForScheduledSync({
      platform: 'SHOPIFY', lastSyncedAt: null,
      syncConfig: { scheduled_sync_disabled: true },
    }, NOW) === false)
}

// Skip platforms unchanged.
for (const platform of SKIP_PLATFORMS) {
  check(`skip platform ${platform} never due`,
    isDueForScheduledSync({ platform, lastSyncedAt: null, syncConfig: {} }, NOW) === false)
}

fanoutTests().then(() => {
  console.log(failures === 0 ? '\nSYNC BACKOFF: PASS' : `\nSYNC BACKOFF: FAIL — ${failures} failure(s)`)
  process.exit(failures === 0 ? 0 : 1)
})
