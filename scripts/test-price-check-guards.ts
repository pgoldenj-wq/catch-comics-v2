/**
 * test-price-check-guards.ts — proves Price Check Popular Products cannot
 * bypass the protections added to Scheduled Retailer Sync.
 *
 * Why this exists: price-check selects retailers by click volume, entirely
 * separately from the hourly cron. It originally applied none of the cron's
 * eligibility rules, so it re-dispatched retailers the scheduler had
 * deliberately excluded. Each such dispatch cost 4 sync attempts plus an
 * on-failure run for a sync that could never succeed. letsbuybooks.com logged
 * 5 runs in 24h while explicitly disabled.
 *
 * Run: npm run test:price-check   (pure functions + SQL text — no DB, no network)
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  isBlockedByRecentAttempt,
  isDueForScheduledSync,
  failureCooldownMs,
  RUN_LEASE_MS,
  SKIP_PLATFORMS,
} from '../lib/sync/dispatch'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`✓ ${label}`)
  else { failures++; console.error(`✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

const NOW = Date.now()
const minsAgo = (m: number) => new Date(NOW - m * 60 * 1000)
const hoursAgo = (h: number) => new Date(NOW - h * 60 * 60 * 1000)

const src = readFileSync(join(__dirname, '..', 'lib', 'inngest', 'functions', 'price-check.ts'), 'utf8')

// ── 1. Disabled retailers are not dispatched ─────────────────────────────────
check('price-check SQL excludes scheduled_sync_disabled',
  src.includes("(ret.sync_config->'scheduled_sync_disabled') IS DISTINCT FROM 'true'::jsonb"))
check('price-check SQL excludes SKIP_PLATFORMS (no adapter exists -> always throws)',
  src.includes('ret.platform::text <> ALL('))
check('price-check imports SKIP_PLATFORMS rather than redefining it',
  src.includes('SKIP_PLATFORMS') && src.includes("from '@/lib/sync/dispatch'"))

// ── 2. Retailers inside backoff are not dispatched ───────────────────────────
check('price-check applies the SHARED backoff predicate, not its own copy',
  src.includes('isBlockedByRecentAttempt'))
check('price-check reads the attempt history it needs to apply it',
  src.includes('"lastAttemptAt"') && src.includes('"consecutiveFailures"'))
check('price-check keys the failure count off last_synced_at (not log status)',
  src.includes("COALESCE(ret.last_synced_at, '-infinity'::timestamptz)"))

// worldofbooks shape: hundreds of failures, attempted an hour ago.
const failing = { lastAttemptAt: minsAgo(59), lastAttemptStatus: 'running', consecutiveFailures: 699 }
check('BUG FIXED: a retailer deep in failure backoff is blocked from price-check',
  isBlockedByRecentAttempt(failing, NOW) === true)
check('a failed retailer is NOT retried repeatedly inside its cooldown (5h in)',
  isBlockedByRecentAttempt({ ...failing, lastAttemptAt: hoursAgo(5) }, NOW) === true)
check('a failed retailer is NOT retried repeatedly inside its cooldown (23h in)',
  isBlockedByRecentAttempt({ ...failing, lastAttemptAt: hoursAgo(23) }, NOW) === true)
check('backoff is a delay, not a ban - eligible again past the 24h cap',
  isBlockedByRecentAttempt({ ...failing, lastAttemptAt: hoursAgo(25) }, NOW) === false)

// A single transient failure must not lock a popular retailer out for a day.
check('one transient failure blocks for 1h only',
  isBlockedByRecentAttempt({ lastAttemptAt: minsAgo(30), lastAttemptStatus: 'error', consecutiveFailures: 1 }, NOW) === true &&
  isBlockedByRecentAttempt({ lastAttemptAt: hoursAgo(2),  lastAttemptStatus: 'error', consecutiveFailures: 1 }, NOW) === false)

// ── 3. A healthy eligible retailer can still be selected ─────────────────────
const healthy = { lastAttemptAt: hoursAgo(7), lastAttemptStatus: 'success', consecutiveFailures: 0 }
check('travellingman-shaped healthy retailer is still dispatchable by price-check',
  isBlockedByRecentAttempt(healthy, NOW) === false)
check('a never-attempted retailer is dispatchable',
  isBlockedByRecentAttempt({ lastAttemptAt: null }, NOW) === false)
check('price freshness is NOT gated on the refresh interval - a retailer synced '
    + '2h ago is still eligible for price-check (that is the point of the job)',
  isBlockedByRecentAttempt({ lastAttemptAt: hoursAgo(2), lastAttemptStatus: 'success', consecutiveFailures: 0 }, NOW) === false &&
  isDueForScheduledSync({ platform: 'SHOPIFY', lastSyncedAt: hoursAgo(2), syncConfig: {},
    lastAttemptAt: hoursAgo(2), lastAttemptStatus: 'success', consecutiveFailures: 0 }, NOW) === false)

// ── 4. No duplicate / overlapping retailer sync ──────────────────────────────
check('an in-flight run holds the lease against price-check too',
  isBlockedByRecentAttempt({ lastAttemptAt: minsAgo(5), lastAttemptStatus: 'running', consecutiveFailures: 0 }, NOW) === true)
check(`a 'running' row older than the ${RUN_LEASE_MS / 60000}min lease is treated as dead`,
  isBlockedByRecentAttempt({ lastAttemptAt: minsAgo(31), lastAttemptStatus: 'running', consecutiveFailures: 0 }, NOW) === false)
check('sync-retailer still pins concurrency to 1 per retailer (belt and braces)',
  readFileSync(join(__dirname, '..', 'lib', 'inngest', 'functions', 'sync-retailer.ts'), 'utf8')
    .includes("key: 'event.data.retailerId'"))

// ── 5. No broad fan-out can occur ────────────────────────────────────────────
check('price-check keeps a hard per-run retailer ceiling', /const MAX_RETAILERS\s*=\s*10\b/.test(src))
check('the ceiling is enforced in SQL, not just in JS', src.includes('LIMIT ${MAX_RETAILERS}'))
check('price-check still passes through the Cost Guard gate', src.includes('inngestCostGate'))
check('child-event fan-out ceiling still guards the adapter path',
  readFileSync(join(__dirname, '..', 'lib', 'sync', 'dispatch.ts'), 'utf8').includes('withFanoutBudget'))

// ── 6. Both dispatchers agree - the predicate cannot drift apart ─────────────
const dispatchSrc = readFileSync(join(__dirname, '..', 'lib', 'sync', 'dispatch.ts'), 'utf8')
check('isBlockedByRecentAttempt is defined once and exported',
  (dispatchSrc.match(/export function isBlockedByRecentAttempt/g) ?? []).length === 1)
check('isDueForScheduledSync delegates to it rather than re-implementing',
  dispatchSrc.includes('if (isBlockedByRecentAttempt(r, now)) return false'))
for (const state of [
  { lastAttemptAt: minsAgo(5),  lastAttemptStatus: 'running', consecutiveFailures: 0 },
  { lastAttemptAt: hoursAgo(2), lastAttemptStatus: 'error',   consecutiveFailures: 3 },
  { lastAttemptAt: hoursAgo(9), lastAttemptStatus: 'error',   consecutiveFailures: 2 },
]) {
  const blocked = isBlockedByRecentAttempt(state, NOW)
  const cronDue = isDueForScheduledSync({ platform: 'SHOPIFY', lastSyncedAt: hoursAgo(48), syncConfig: {}, ...state }, NOW)
  check(`both dispatchers agree for ${state.consecutiveFailures} fail(s)/${state.lastAttemptStatus}: blocked=${blocked}`,
    blocked ? cronDue === false : true)
}

// Skip platforms unchanged.
check('SKIP_PLATFORMS still covers every adapter-less platform',
  ['EBAY','MANUAL','DIRECT_AFFILIATE','CJ_FEED','DYNAMIC_LINK'].every(p => SKIP_PLATFORMS.has(p)))
check('cooldown curve unchanged by this PR', failureCooldownMs(1) === 3_600_000 && failureCooldownMs(6) === 86_400_000)

console.log(failures === 0 ? '\nPRICE CHECK GUARDS: PASS' : `\nPRICE CHECK GUARDS: FAIL — ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
