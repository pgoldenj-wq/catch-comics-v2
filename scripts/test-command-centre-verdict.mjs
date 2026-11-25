/**
 * Regression tests for the Command Centre verdict logic.
 *
 * The 2026-11-25 incident: one smoke run reported
 *   "19 passed · 2 warnings · 0 failed"  → launcher printed "All good"
 *   the dashboard rendered              → "PRODUCTION FAILING · 19/21 checks"
 * Same file, same run, opposite conclusions — and both wrong. Nothing had
 * failed, and what was actually broken (zero priced listings) was shown by
 * neither.
 *
 * These tests extract the REAL expressions out of launch/launch-control.html
 * rather than restating them, so the test cannot drift from what ships.
 *
 * Local fixtures only. No network, no database, no production traffic.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HTML = readFileSync(join(ROOT, 'launch', 'launch-control.html'), 'utf8')

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

// ── extract the shipped verdict block ───────────────────────────────────────
function extract(startMarker, endMarker) {
  const a = HTML.indexOf(startMarker)
  const b = HTML.indexOf(endMarker, a)
  if (a === -1 || b === -1) throw new Error(`could not locate block: ${startMarker}`)
  return HTML.slice(a, b)
}

const verdictSrc = extract('const sFailed =', 'const ready =')

/** Evaluate the shipped expressions against a fixture. */
function evaluate({ smoke, health }) {
  const ago = () => 'just now'
  const fn = new Function('smoke', 'health', 'ago', `
    ${verdictSrc}
    return { prodLabel, prodClass, prodSub, priceLabel, priceClass, priceSub };
  `)
  return fn(smoke, health, ago)
}

const healthNone     = { generatedAt: '2026-11-25T12:14:00Z', pricing: { pricedListings: 0, productsPriced: 0, comparisonDepth: { twoPlusRetailers: 0 } } }
const healthSingle   = { generatedAt: '2026-11-25T12:14:00Z', pricing: { pricedListings: 40, productsPriced: 38, comparisonDepth: { twoPlusRetailers: 0 } } }
const healthCompare  = { generatedAt: '2026-11-25T12:14:00Z', pricing: { pricedListings: 60, productsPriced: 50, comparisonDepth: { twoPlusRetailers: 7 } } }

console.log('\nTHE EXACT 2026-11-25 CASE — 19 passed · 2 warnings · 0 failed')
{
  const smoke = { verdict: 'PASS-WITH-WARNINGS', passed: 19, warned: 2, failed: 0, checkedAt: '2026-11-25T12:14:36Z' }
  const r = evaluate({ smoke, health: healthNone })
  console.log(`    Production     : ${r.prodLabel} (${r.prodClass}) — ${r.prodSub}`)
  console.log(`    Price compare  : ${r.priceLabel} (${r.priceClass}) — ${r.priceSub}`)
  ok('Production is NOT red (0 checks failed)', r.prodClass !== 'red', `got ${r.prodClass}`)
  ok('Production reads DEGRADED, not FAILING', r.prodLabel === 'DEGRADED', `got ${r.prodLabel}`)
  ok('sub-line no longer renders the misleading "19/21"', !r.prodSub.includes('19/21'), r.prodSub)
  ok('sub-line states warnings separately from failures', r.prodSub.includes('2 warnings') && r.prodSub.includes('0 failed'), r.prodSub)
  ok('the REAL problem is surfaced: price comparison NONE', r.priceLabel === 'NONE', `got ${r.priceLabel}`)
  ok('price comparison is the red cell', r.priceClass === 'red', `got ${r.priceClass}`)
}

console.log('\nA REAL FAILURE MUST STILL GO RED (nothing may mask it)')
{
  const smoke = { verdict: 'FAIL', passed: 18, warned: 2, failed: 1, checkedAt: '2026-11-25T12:14:36Z' }
  const r = evaluate({ smoke, health: healthCompare })
  console.log(`    Production     : ${r.prodLabel} (${r.prodClass}) — ${r.prodSub}`)
  ok('Production reads FAILING', r.prodLabel === 'FAILING', `got ${r.prodLabel}`)
  ok('Production is red', r.prodClass === 'red', `got ${r.prodClass}`)
  ok('healthy pricing does not mask the failure', r.priceLabel === 'COMPARING' && r.prodClass === 'red')
}

console.log('\nFULLY HEALTHY — everything passed, prices comparing')
{
  const smoke = { verdict: 'PASS', passed: 21, warned: 0, failed: 0, checkedAt: '2026-11-25T12:14:36Z' }
  const r = evaluate({ smoke, health: healthCompare })
  console.log(`    Production     : ${r.prodLabel} (${r.prodClass}) — ${r.prodSub}`)
  console.log(`    Price compare  : ${r.priceLabel} (${r.priceClass}) — ${r.priceSub}`)
  ok('Production HEALTHY/green', r.prodLabel === 'HEALTHY' && r.prodClass === 'green')
  ok('Price comparison COMPARING/green', r.priceLabel === 'COMPARING' && r.priceClass === 'green')
}

console.log('\nSITE UP BUT ONLY ONE RETAILER — availability and pricing diverge')
{
  const smoke = { verdict: 'PASS', passed: 21, warned: 0, failed: 0, checkedAt: '2026-11-25T12:14:36Z' }
  const r = evaluate({ smoke, health: healthSingle })
  console.log(`    Production     : ${r.prodLabel} (${r.prodClass})`)
  console.log(`    Price compare  : ${r.priceLabel} (${r.priceClass}) — ${r.priceSub}`)
  ok('technical availability stays HEALTHY', r.prodLabel === 'HEALTHY')
  ok('pricing reads SINGLE (amber), not green', r.priceLabel === 'SINGLE' && r.priceClass === 'amber')
}

console.log('\nNO HEALTH REPORT — unknown must not read as healthy')
{
  const smoke = { verdict: 'PASS', passed: 21, warned: 0, failed: 0, checkedAt: '2026-11-25T12:14:36Z' }
  const r = evaluate({ smoke, health: null })
  ok('pricing reads UNKNOWN', r.priceLabel === 'UNKNOWN', `got ${r.priceLabel}`)
  ok('UNKNOWN is amber, never green', r.priceClass === 'amber', `got ${r.priceClass}`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed · ${fail} failed\n`)
process.exit(fail > 0 ? 1 : 0)
