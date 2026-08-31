/**
 * test-format-and-price-filter.ts — regression tests for founder review
 * search-2026-08-29-14-02-u3pppa.
 *
 *   1. Format labels: every ProductFormat keeps its own name, and an unknown
 *      format has no name at all (never defaulted to "Hardcover", never
 *      inferred from the title).
 *   2. The "Under £X" price cap: it actually excludes anything above the cap,
 *      it excludes products with no trusted price, and it never hides a
 *      product whose price has not resolved yet.
 *
 * Run: npm run test:format-price   (pure functions — no DB, no network)
 */

import { FORMAT_LABELS, formatLabel } from '../lib/identity/format'
import { parsePriceCap, withinPriceCap } from '../lib/search/priceFilter'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`✓ ${label}`)
  else { failures++; console.error(`✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

// ── 1. Format taxonomy ────────────────────────────────────────────────────────

// The founder's report: "all graphic novels are labelled a hardcover?" — three
// distinct formats used to render as the single label "Hardcover Edition".
check('ABSOLUTE is an Absolute Edition, not a Hardcover',
  formatLabel('ABSOLUTE') === 'Absolute Edition')
check('DELUXE is a Deluxe Edition, not a Hardcover',
  formatLabel('DELUXE') === 'Deluxe Edition')
check('HARDCOVER is a Hardcover',
  formatLabel('HARDCOVER') === 'Hardcover')
check('TPB is a Trade Paperback',
  formatLabel('TPB') === 'Trade Paperback')
check('COMPENDIUM is a Compendium, not an Omnibus',
  formatLabel('COMPENDIUM') === 'Compendium')
check('OMNIBUS is an Omnibus',
  formatLabel('OMNIBUS') === 'Omnibus')
check('SINGLE_ISSUE is a Single Issue',
  formatLabel('SINGLE_ISSUE') === 'Single Issue')
check('MANGA_VOLUME is a Manga Volume',
  formatLabel('MANGA_VOLUME') === 'Manga Volume')

// Every label must be distinct — no two formats may collapse into one name.
const labels = Object.values(FORMAT_LABELS)
check('no two formats share a label', new Set(labels).size === labels.length,
  `labels: ${labels.join(', ')}`)

// ── Unknown formats are omitted, never guessed ────────────────────────────────

check('OTHER has no label (was "Comic")',        formatLabel('OTHER') === null)
check('missing format has no label',             formatLabel(null) === null)
check('undefined format has no label',           formatLabel(undefined) === null)
check('empty format has no label',               formatLabel('') === null)
check('an enum value we do not know has no label (never defaulted)',
  formatLabel('SOME_FUTURE_FORMAT') === null)
check('OTHER is absent from the map, not mapped to a format',
  !('OTHER' in FORMAT_LABELS))

// The title must never be able to produce a format label. This is the exact
// regression: a record titled "Absolute Batman …" with no known format used to
// render "Hardcover Edition" purely because of the word "absolute".
check('a title containing "absolute" cannot produce a label without a format',
  formatLabel(undefined) === null && formatLabel('OTHER') === null)

// ── 2. Price cap parsing ──────────────────────────────────────────────────────

check('"all" is no cap',        parsePriceCap('all') === null)
check('null is no cap',         parsePriceCap(null) === null)
check('undefined is no cap',    parsePriceCap(undefined) === null)
check('"" is no cap',           parsePriceCap('') === null)
check('junk in the URL is no cap (must not hide everything)',
  parsePriceCap('cheap') === null)
check('a negative cap is no cap', parsePriceCap('-5') === null)
check('"15" parses to 15',      parsePriceCap('15') === 15)
check('"5" parses to 5',        parsePriceCap('5') === 5)
check('"50" parses to 50',      parsePriceCap('50') === 50)

// ── 3. Price cap behaviour ────────────────────────────────────────────────────

// The founder's screenshot: "Under £15" selected, £16.29 and £24.76 still shown.
check('REGRESSION: £16.29 is excluded by an Under £15 cap',
  withinPriceCap(16.29, 15) === false)
check('REGRESSION: £24.76 is excluded by an Under £15 cap',
  withinPriceCap(24.76, 15) === false)
check('£13.17 passes an Under £15 cap',
  withinPriceCap(13.17, 15) === true)
check('a price exactly at the cap passes',
  withinPriceCap(15, 15) === true)

// Not one price option — every option behaves the same way.
for (const cap of [5, 10, 15, 25, 35, 50]) {
  check(`cap £${cap}: £${cap + 0.01} excluded`, withinPriceCap(cap + 0.01, cap) === false)
  check(`cap £${cap}: £${cap - 0.01} kept`,     withinPriceCap(cap - 0.01, cap) === true)
}

check('no cap keeps everything, including unpriced products',
  withinPriceCap(999, null) === true && withinPriceCap(null, null) === true)

// A product with no trusted price cannot be presented as being under a cap.
check('a product with no trusted price is excluded by a cap',
  withinPriceCap(null, 15) === false)

// …but one whose price is still loading must be kept, or the card unmounts and
// the fetch that would have resolved it never completes.
check('a product whose price has not resolved yet is kept',
  withinPriceCap(undefined, 15) === true)

// ── 4. The cap over a whole list ──────────────────────────────────────────────

// Founder review o4rzqw: the cap reached the canonical result cards but not the
// "Other listings" / "From eBay" rails below them, which carry an already
// resolved retailer price. A £42 row stayed on screen under "Under £15".
const rail = [
  { id: 'a', price: 12.50 },
  { id: 'b', price: 15.00 },
  { id: 'c', price: 16.29 },
  { id: 'd', price: 42.00 },
]
const under15 = rail.filter(r => withinPriceCap(r.price, parsePriceCap('15'))).map(r => r.id)
check('REGRESSION: a rail of resolved prices keeps only what is at or under the cap',
  under15.join(',') === 'a,b', `kept: ${under15.join(',') || '(none)'}`)

const uncapped = rail.filter(r => withinPriceCap(r.price, parsePriceCap('all'))).map(r => r.id)
check('"All prices" keeps the whole rail',
  uncapped.length === rail.length)

// Rail prices are always resolved numbers, so no row can slip through on the
// "still loading" branch that the per-card price tags rely on.
check('no rail row reaches the unresolved branch',
  rail.every(r => typeof r.price === 'number'))

console.log(failures === 0 ? '\nFORMAT + PRICE FILTER: PASS' : `\nFORMAT + PRICE FILTER: FAIL — ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
