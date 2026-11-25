/**
 * Tests the pricing early-warning added to scripts/launch-health.ts.
 *
 * What it must catch that the old report could not: on 2026-10-27 the 30-day
 * retention sweep deleted all 2,280 priced listings, exactly 30 days after
 * the last refresh. Every freshness figure read "0 stale (0%)" the next
 * morning — identical to a perfectly clean catalogue — because the numbers
 * were computed over listings that no longer existed.
 *
 * The alert is keyed on last_seen_at (which advances only when a refresh
 * actually re-observed an offer) and on the retention deadline, so a job that
 * merely started cannot satisfy it.
 *
 * Extracts the real block out of launch-health.ts so the test cannot drift.
 * Local fixtures only — no database.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TS = readFileSync(join(ROOT, 'scripts', 'launch-health.ts'), 'utf8')

const a = TS.indexOf('const RETENTION_DAYS')
const b = TS.indexOf('const snapshot =', a)
if (a === -1 || b === -1) throw new Error('could not locate the pricing alert block')
// Strip the few TS annotations so the block runs as plain JS.
const src = TS.slice(a, b)
  .replace(/let pricingAlertLevel: *'OK' *\| *'WARN' *\| *'CRITICAL'/, 'let pricingAlertLevel')
  .replace(/const pricingAlertReasons: *string\[\]/, 'const pricingAlertReasons')

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const DAY = 864e5
const daysAgo = d => new Date(Date.now() - d * DAY).toISOString()

function evaluate({ pricedListings, oldestSeenDaysAgo, newestSeenDaysAgo, twoPlus, prevPriced }) {
  const n = v => Number(v ?? 0)
  const price = { priced_listings: pricedListings }
  const expiry = pricedListings === 0 ? { oldest_live_seen: null, newest_live_seen: null, expiring_within_7d: 0 } : {
    oldest_live_seen: daysAgo(oldestSeenDaysAgo),
    newest_live_seen: daysAgo(newestSeenDaysAgo),
    expiring_within_7d: oldestSeenDaysAgo >= 23 ? 1 : 0,
  }
  const previous = prevPriced === undefined ? null : { pricing: { pricedListings: prevPriced } }
  const fn = new Function('n', 'price', 'expiry', 'previous', 'twoPlus', `
    ${src}
    return { pricingAlertLevel, pricingAlertReasons, nextExpiryAt, daysUntilNextExpiry, lastSuccessfulWriteAgeDays };
  `)
  return fn(n, price, expiry, previous, twoPlus)
}

console.log('\nTODAY — 0 priced listings (the live incident)')
{
  const r = evaluate({ pricedListings: 0, twoPlus: 0 })
  console.log(`    ${r.pricingAlertLevel}: ${r.pricingAlertReasons[0]}`)
  ok('level is CRITICAL', r.pricingAlertLevel === 'CRITICAL', r.pricingAlertLevel)
  ok('says comparison is DOWN, not stale', r.pricingAlertReasons.join(' ').includes('DOWN'))
  ok('explains that 0% freshness is an empty set', r.pricingAlertReasons.join(' ').includes('empty, not clean'))
}

console.log('\nTHE WARNING THAT WOULD HAVE FIRED BEFORE 27 OCTOBER')
{
  // 26 days since the last re-observation: 4 days until the sweep takes them.
  const r = evaluate({ pricedListings: 2280, oldestSeenDaysAgo: 26, newestSeenDaysAgo: 26, twoPlus: 0 })
  console.log(`    ${r.pricingAlertLevel}: ${r.pricingAlertReasons[0]}`)
  ok('level is WARN while offers still exist', r.pricingAlertLevel === 'WARN', r.pricingAlertLevel)
  ok('names the deletion date', /retention sweep removes it on \d{4}-\d{2}-\d{2}/.test(r.pricingAlertReasons[0]))
  ok('counts down ~4 days', r.daysUntilNextExpiry > 3 && r.daysUntilNextExpiry <= 4.1, String(r.daysUntilNextExpiry))
  ok('cites the real last write age', r.lastSuccessfulWriteAgeDays >= 25.9, String(r.lastSuccessfulWriteAgeDays))
}

console.log('\nHEALTHY — refreshed yesterday, comparison working')
{
  const r = evaluate({ pricedListings: 2280, oldestSeenDaysAgo: 1, newestSeenDaysAgo: 1, twoPlus: 40 })
  ok('level is OK', r.pricingAlertLevel === 'OK', r.pricingAlertLevel)
  ok('no reasons raised', r.pricingAlertReasons.length === 0)
  ok('expiry is ~29 days out', r.daysUntilNextExpiry > 28, String(r.daysUntilNextExpiry))
}

console.log('\nPRICED BUT NO GENUINE COMPARISON')
{
  const r = evaluate({ pricedListings: 800, oldestSeenDaysAgo: 2, newestSeenDaysAgo: 1, twoPlus: 0 })
  ok('level is WARN', r.pricingAlertLevel === 'WARN', r.pricingAlertLevel)
  ok('says no comparison possible', r.pricingAlertReasons.join(' ').includes('2+ retailers'))
}

console.log('\nOVERDUE — already past the deadline')
{
  const r = evaluate({ pricedListings: 100, oldestSeenDaysAgo: 31, newestSeenDaysAgo: 31, twoPlus: 5 })
  ok('level escalates to CRITICAL', r.pricingAlertLevel === 'CRITICAL', r.pricingAlertLevel)
  ok('days-until-expiry is negative', r.daysUntilNextExpiry < 0, String(r.daysUntilNextExpiry))
}

console.log('\nCOVERAGE COLLAPSE between snapshots')
{
  const r = evaluate({ pricedListings: 120, oldestSeenDaysAgo: 1, newestSeenDaysAgo: 1, twoPlus: 9, prevPriced: 2280 })
  console.log(`    ${r.pricingAlertLevel}: ${r.pricingAlertReasons.slice(-1)[0]}`)
  ok('level is CRITICAL on a >10% drop', r.pricingAlertLevel === 'CRITICAL', r.pricingAlertLevel)
  ok('quotes both counts', r.pricingAlertReasons.join(' ').includes('2,280') && r.pricingAlertReasons.join(' ').includes('120'))
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed · ${fail} failed\n`)
process.exit(fail > 0 ? 1 : 0)
