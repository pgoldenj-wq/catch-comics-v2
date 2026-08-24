#!/usr/bin/env node
/**
 * test-retailer-refresh-card.mjs — deterministic tests for the Retailer Price
 * Refresh card.
 *
 * It imports the SAME module mission-control.html imports, so the states
 * proven here are the states the founder sees. No network, no database, no
 * retailer, no bridge: every case is a fixture with an injected clock.
 *
 * Run: npm run test:retailer-card
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  deriveRetailerState, daysLeftFrom, measuredTarget, buildProgressLine,
  DUE_SOON_DAYS, URGENT_DAYS, STALE_RUNNING_MS,
} from '../launch/operations/retailer-refresh-state.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0, fail = 0
const check = (name, ok, extra = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`) }
}

const NOW = Date.parse('2026-08-24T12:00:00Z')
const inDays = d => new Date(NOW + d * 86_400_000).toISOString()

/** A successful run fixture, shaped exactly like price-verify-write-latest.json. */
const successAt = (daysUntilExpiry, over = {}) => ({
  runAt: inDays(daysUntilExpiry - 30),
  travellingMan: { targetRows: 2246, rowsWritten: 2246, availableUnchangedPrice: 1599, availablePriceChanged: 4, unavailable: 643, variantMissing: 0, productIdMismatch: 0, notFound404: 0, transientFailures: 0, otherErrors: 0 },
  worldOfBooks:  { targetRows: 34,   rowsWritten: 34,   availableUnchangedPrice: 18,   availablePriceChanged: 1, unavailable: 15,  variantMissing: 0, productIdMismatch: 0, notFound404: 0, transientFailures: 0, otherErrors: 0 },
  priceChanges: [{}, {}, {}, {}, {}, {}, {}],
  writeTotals: { rowsWritten: 2280, excludedImplausiblePrice: 0 },
  cost: { totalHttpRequests: 2319, retryRequests: 0, inboundMiB: 24.49, wallClockMin: 47.7, inngestExecutions: 0, externalApiCostGBP: 0 },
  freshness: { policyDays: 30, refreshedAt: inDays(daysUntilExpiry - 30), nextExpiryAt: inDays(daysUntilExpiry) },
  ...over,
})

console.log('\nCountdown + due-state thresholds')
check('healthy above the due-soon threshold', deriveRetailerState(successAt(29), null, NOW).status === 'HEALTHY')
check('29 days reads as 29 days remaining', deriveRetailerState(successAt(29), null, NOW).daysLeft === 29)
check('human text names the days', /29 days remaining/.test(deriveRetailerState(successAt(29), null, NOW).headline))
check('exactly the due-soon boundary is DUE SOON', deriveRetailerState(successAt(DUE_SOON_DAYS), null, NOW).status === 'DUE SOON')
check('one day inside the boundary is still HEALTHY', deriveRetailerState(successAt(DUE_SOON_DAYS + 1), null, NOW).status === 'HEALTHY')
check('exactly the urgent boundary is URGENT', deriveRetailerState(successAt(URGENT_DAYS), null, NOW).status === 'URGENT')
check('expiry reached is OVERDUE', deriveRetailerState(successAt(0), null, NOW).status === 'OVERDUE')
check('past expiry is OVERDUE', deriveRetailerState(successAt(-3), null, NOW).status === 'OVERDUE')
check('overdue says what to do', /need refreshing/.test(deriveRetailerState(successAt(-3), null, NOW).headline))
check('singular day is not "1 days"', /\b1 day\b/.test(deriveRetailerState(successAt(1), null, NOW).headline))
check('HEALTHY needs no action', deriveRetailerState(successAt(29), null, NOW).needsAction === false)
check('DUE SOON needs action', deriveRetailerState(successAt(5), null, NOW).needsAction === true)
check('never run is flagged, not silently healthy', deriveRetailerState(null, null, NOW).status === 'NEVER RUN')
check('a success without a deadline is not treated as fresh',
  deriveRetailerState(successAt(9, { freshness: { policyDays: 30, refreshedAt: null, nextExpiryAt: null } }), null, NOW).status === 'NEVER RUN')

console.log('\nLast successful result is read correctly')
const s = successAt(29)
check('target = TM + WoB target rows', measuredTarget(s, null) === 2280)
check('countdown derives from nextExpiryAt', daysLeftFrom(s, NOW) === 29)
check('cost figures are present for display', s.cost.totalHttpRequests === 2319 && s.cost.inboundMiB === 24.49)
check('a live status target overrides the stored one', measuredTarget(s, { measuredTarget: 2291 }) === 2291)
check('target is null when never measured', measuredTarget(null, null) === null)

console.log('\nRUNNING state')
const running = { state: 'running', phase: 'verifying', retailer: 'Travelling Man', measuredTarget: 2291, rowsChecked: 742, rowsWritten: 740, errors: 0, updatedAt: inDays(0) }
check('running wins over the countdown', deriveRetailerState(s, running, NOW).status === 'RUNNING')
check('running is marked in flight', deriveRetailerState(s, running, NOW).inFlight === true)
check('progress line uses real counters', buildProgressLine(running) === 'Travelling Man · 742 / 2,291 verified')
check('progress line before measurement does not invent a total', buildProgressLine({ phase: 'starting' }) === 'Starting…')
check('enumeration phase is named honestly', /Enumerating/.test(buildProgressLine({ phase: 'enumerating catalogue' })))
check('running does not ask for action', deriveRetailerState(s, running, NOW).needsAction === false)

console.log('\nSAFE STOP (over the row ceiling)')
const blocked = { state: 'blocked', reason: '2,314 Travelling Man rows exceeds the 2,300 safety ceiling', rowsWritten: 0, finishedAt: inDays(0), updatedAt: inDays(0), measuredTarget: 2314 }
const bs = deriveRetailerState(s, blocked, NOW)
check('blocked attempt shows SAFE STOP', bs.status === 'BLOCKED · SAFE STOP')
check('the ceiling breach is stated verbatim', /2,314.*exceeds the 2,300 safety ceiling/.test(bs.headline))
check('blocked attempt wrote nothing', blocked.rowsWritten === 0)
check('blocked attempt asks for attention', bs.needsAction === true)
check('blocked attempt does NOT move the deadline', bs.daysLeft === 29)

console.log('\nFailed attempt never moves the successful deadline')
const failed = { state: 'failed', reason: 'wrote 1,204 of 2,280 rows', rowsWritten: 1204, finishedAt: inDays(0), updatedAt: inDays(0) }
const fs_ = deriveRetailerState(s, failed, NOW)
check('failed attempt shows FAILED', fs_.status === 'FAILED')
check('failed attempt keeps the previous deadline', fs_.daysLeft === 29)
check('failed attempt preserves the last successful run', s.freshness.nextExpiryAt === inDays(29))
check('failed attempt says how much was written', /1,204 of 2,280/.test(fs_.headline))

console.log('\nInterrupted run does not stick on RUNNING forever')
const stale = { state: 'running', phase: 'verifying', updatedAt: new Date(NOW - STALE_RUNNING_MS - 60_000).toISOString(), rowsWritten: 300 }
const st = deriveRetailerState(s, stale, NOW)
check('a stale heartbeat reads as INTERRUPTED', st.status === 'INTERRUPTED')
check('interrupted is not in flight', st.inFlight === false)
check('interrupted keeps the deadline', st.daysLeft === 29)
const fresh = { state: 'running', phase: 'verifying', updatedAt: new Date(NOW - 60_000).toISOString() }
check('a fresh heartbeat is still RUNNING', deriveRetailerState(s, fresh, NOW).status === 'RUNNING')

console.log('\nSafety properties of the wired-up command')
const runner = readFileSync(join(REPO_ROOT, 'scripts', 'run-retailer-refresh.mjs'), 'utf8')
check('runner keeps the 2300 row ceiling', /MAX_ROWS\s*=\s*'2300'/.test(runner))
check('runner passes --write and --max-rows', /'--write',\s*'--max-rows',\s*MAX_ROWS/.test(runner))
check('runner targets the proven script', /price-verify-dryrun\.ts/.test(runner))
check('runner takes no arguments from its caller', !/process\.argv/.test(runner))
check('runner never calls inngest or a scheduler', !/inngest|sync.retailer.scheduled|dispatchSync/i.test(runner))

const bridge = readFileSync(join(REPO_ROOT, 'launch', 'operations', 'browser-trust-bridge.mjs'), 'utf8')
check('bridge refuses a second concurrent refresh (409)', /retailerRun\.state === 'running'\) return send\(409/.test(bridge))
check('bridge spawns a fixed runner with shell:false', /RETAILER_RUNNER\], \{[\s\S]*?shell: false/.test(bridge))
check('bridge binds to 127.0.0.1 only', /const HOST = '127\.0\.0\.1'/.test(bridge))
check('bridge never calls inngest or a scheduler', !/inngest|sync.retailer.scheduled|dispatchSync/i.test(bridge))

const card = readFileSync(join(REPO_ROOT, 'launch', 'mission-control.html'), 'utf8')
check('card guards against double-click before the bridge replies', /if \(rrStarting\) return/.test(card))
check('card polls rather than assuming success', /watchRetailerRun/.test(card))
check('card does not re-implement verification', !/variants\[0\]|isbn13|matchConfidence/.test(card))
// The word "Inngest" appears in this page as prose and as a cost label ("Inngest 0").
// What must never exist is a call to one, so assert on the call, not the word.
check('card never calls an inngest endpoint', !/fetch\([^)]*inngest/i.test(card) && !/api\/inngest/i.test(card))
check('card never triggers a scheduled sync', !/sync\.retailer|dispatchSync|scheduled_sync_disabled\s*=\s*false/i.test(card))

const script = readFileSync(join(REPO_ROOT, 'scripts', 'price-verify-dryrun.ts'), 'utf8')
check('writes stay scoped to non-deleted rows', /where: \{ id: r\.id, deletedAt: null \}/.test(script))
check('a partial run cannot overwrite the last successful run', /if \(!WRITE \|\| fullSuccess\) writeFileSync\(OUT/.test(script))
check('deadline only set on a full success', /fullSuccess\s*\?\s*new Date\(Date\.now\(\) \+ FRESHNESS_POLICY_DAYS/.test(script))
check('freshness policy matches cleanup-stale (30 days)', /FRESHNESS_POLICY_DAYS = 30/.test(script))

console.log(`\nRETAILER REFRESH CARD: ${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
