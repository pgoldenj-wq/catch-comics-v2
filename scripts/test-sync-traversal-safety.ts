/**
 * test-sync-traversal-safety.ts — proves a partial catalogue traversal can
 * never be mistaken for evidence that stock disappeared.
 *
 * The incident this exists for (2026-08-18): a deliberate 5-page run over
 * Travelling Man's ~90-page catalogue treated the 95% it never fetched as
 * missing inventory. 1,361 listings flipped to OUT_OF_STOCK and 25,381 SKUs
 * were written to prev_missing_skus, arming the next run to flip the rest.
 * Nothing was wrong at the retailer — the run simply had not looked.
 *
 * The invariant: absence reconciliation may only run when the traversal is
 * PROVEN complete. Everything else (capped, interrupted, aborted) reconciles
 * nothing and records nothing.
 *
 * Run: npm run test:traversal-safety   (pure functions — no DB, no network)
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { StockStatus } from '@prisma/client'
import { reconcileAbsence } from '../lib/adapters/shared/matching'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`✓ ${label}`)
  else { failures++; console.error(`✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

/** A catalogue of 5 listings; a partial run only ever sees the first two. */
const listings = [
  { id: 'l1', retailerSku: '101', stockStatus: StockStatus.IN_STOCK },
  { id: 'l2', retailerSku: '102', stockStatus: StockStatus.IN_STOCK },
  { id: 'l3', retailerSku: '103', stockStatus: StockStatus.IN_STOCK },  // never fetched
  { id: 'l4', retailerSku: '104', stockStatus: StockStatus.IN_STOCK },  // never fetched
  { id: 'l5', retailerSku: '105', stockStatus: StockStatus.OUT_OF_STOCK },
]
const partialPages = new Set(['101', '102'])          // pages 1-2 of 5
const fullCatalogue = new Set(['101', '102', '103', '104', '105'])

/* ── 1. Partial run: observes, but reconciles nothing ────────────────────── */

const partial = reconcileAbsence({
  traversalComplete: false,
  dbListings: listings,
  skusEncountered: partialPages,
  prevMissingSkus: new Set(['103', '104']),   // already missing once
})
check('partial run does not reconcile', partial.reconciled === false)
check('partial run marks nothing OUT_OF_STOCK', partial.idsToMarkOos.length === 0,
  `would have marked ${partial.idsToMarkOos.length}`)
check('partial run records no missing SKUs (does not arm the next run)',
  partial.currentMissingSkus.length === 0, `recorded ${partial.currentMissingSkus.length}`)
check('the 2026-08-18 shape: unvisited listings survive a capped run',
  !partial.idsToMarkOos.includes('l3') && !partial.idsToMarkOos.includes('l4'))

/* ── 2. Interrupted run ──────────────────────────────────────────────────── */

const interrupted = reconcileAbsence({
  traversalComplete: false,
  dbListings: listings,
  skusEncountered: new Set(['101']),   // died mid-page-2
  prevMissingSkus: new Set(['102', '103', '104', '105']),
})
check('interrupted run does not reconcile absence', interrupted.reconciled === false)
check('interrupted run marks nothing', interrupted.idsToMarkOos.length === 0)

/* ── 3. Failed run (403/5xx abort) ───────────────────────────────────────── */

const failed = reconcileAbsence({
  traversalComplete: false,
  dbListings: listings,
  skusEncountered: new Set<string>(),   // aborted before any page landed
  prevMissingSkus: new Set(['101', '102', '103', '104', '105']),
})
check('failed run does not reconcile absence', failed.reconciled === false)
check('failed run cannot wipe out an entire catalogue', failed.idsToMarkOos.length === 0)

/* ── 4. Proven complete traversal may reconcile ──────────────────────────── */

const complete = reconcileAbsence({
  traversalComplete: true,
  dbListings: listings,
  skusEncountered: new Set(['101', '102', '105']),   // 103, 104 genuinely gone
  prevMissingSkus: new Set(['103', '104']),          // and gone last time too
})
check('complete traversal reconciles', complete.reconciled === true)
check('genuinely absent listings (2 consecutive) are marked OUT_OF_STOCK',
  complete.idsToMarkOos.length === 2 && complete.idsToMarkOos.includes('l3') && complete.idsToMarkOos.includes('l4'),
  JSON.stringify(complete.idsToMarkOos))
check('present listings are never marked', !complete.idsToMarkOos.includes('l1') && !complete.idsToMarkOos.includes('l2'))
check('complete traversal records the current missing set for next time',
  complete.currentMissingSkus.sort().join(',') === '103,104')

/* ── 5. The one-miss guard still holds after the fix ─────────────────────── */

const firstMiss = reconcileAbsence({
  traversalComplete: true,
  dbListings: listings,
  skusEncountered: new Set(['101', '102', '105']),
  prevMissingSkus: new Set(),          // first time they are missing
})
check('one complete sync missing an item does NOT mark it OUT_OF_STOCK',
  firstMiss.idsToMarkOos.length === 0)
check('...but it is recorded, so a second complete miss will',
  firstMiss.currentMissingSkus.sort().join(',') === '103,104')

const secondMiss = reconcileAbsence({
  traversalComplete: true,
  dbListings: listings,
  skusEncountered: new Set(['101', '102', '105']),
  prevMissingSkus: new Set(firstMiss.currentMissingSkus),
})
check('two completed catalogues omitting an item DO mark it OUT_OF_STOCK (protection intact)',
  secondMiss.idsToMarkOos.length === 2)

/* ── Already-OOS rows are not rewritten ──────────────────────────────────── */

const alreadyOos = reconcileAbsence({
  traversalComplete: true,
  dbListings: listings,
  skusEncountered: new Set(['101', '102']),
  prevMissingSkus: new Set(['103', '104', '105']),
})
check('a listing already OUT_OF_STOCK is not marked again', !alreadyOos.idsToMarkOos.includes('l5'))

/* ── Comic-filter interaction ────────────────────────────────────────────── */
// skusEncountered is populated BEFORE the comic filter, so a filtered-out
// product is still "present at the retailer" and must not be reconciled away.
const filtered = reconcileAbsence({
  traversalComplete: true,
  dbListings: listings,
  skusEncountered: fullCatalogue,      // every SKU seen in the feed
  prevMissingSkus: new Set(['103', '104']),
})
check('products skipped by the comic filter are not treated as absent',
  filtered.idsToMarkOos.length === 0 && filtered.currentMissingSkus.length === 0)

/* ── no-create mode ──────────────────────────────────────────────────────── */
// matchCanonical talks to the database directly, so this asserts the property
// structurally: every canonical-creation site in the matcher must sit behind
// the allowCreate gate. A new creation path added later fails this check.
// The behavioural proof is the recovery run itself, which asserts the product
// count is unchanged.

const matchingSrc = readFileSync(join(__dirname, '..', 'lib', 'adapters', 'shared', 'matching.ts'), 'utf8')
const creationSites = (matchingSrc.match(/prisma\.canonicalProduct\.create\(/g) ?? []).length
check('matcher has exactly one canonical-creation site', creationSites === 1, `found ${creationSites}`)

const gateIdx  = matchingSrc.indexOf('if (!allowCreate)')
const createIdx = matchingSrc.indexOf('prisma.canonicalProduct.create(')
check('the no-create gate exists', gateIdx !== -1)
check('the gate precedes the only creation site', gateIdx !== -1 && gateIdx < createIdx)
check('matchCanonical accepts allowCreate', /allowCreate\s*=\s*true/.test(matchingSrc))

const shopifySrc = readFileSync(join(__dirname, '..', 'lib', 'adapters', 'shopify.ts'), 'utf8')
check('the Shopify adapter threads allowCreate into the matcher',
  /matchCanonical\([^)]*allowCreate\)/.test(shopifySrc))
check('the Shopify adapter never creates canonical products itself',
  !/prisma\.canonicalProduct\.create\(/.test(shopifySrc))

console.log(failures === 0 ? '\nTRAVERSAL SAFETY: PASS' : `\nTRAVERSAL SAFETY: FAIL — ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
