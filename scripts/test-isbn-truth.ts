/**
 * test-isbn-truth.ts — regression tests for the ISBN failure modes found by
 * the 2026-08-26 ISBN truth audit.
 *
 * Every case here corresponds to something that was actually wrong, or to a
 * product-truth rule that must never be relaxed to make a number look better.
 *
 * Run: npm run test:isbn   (pure functions — no DB, no network)
 */

import {
  normalizeIsbn13, isbn10To13, isbn13To10, normalizeAnyIsbn,
  isValidIsbn13, classifyBarcode, hasBookPrefix, hasValidEan13Checksum,
} from '../lib/identity/isbn'
import { extractIdentifiers } from '../lib/adapters/shared/matching'
import { editionMatchVerdict } from '../lib/identity/edition'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`✓ ${label}`)
  else { failures++; console.error(`✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

console.log('\n── ISBN-13: shape, prefix, checksum ──────────────────────────')

// Lone Wolf and Cub Deluxe Edition Vol 1 — a real product in the catalogue.
check('valid ISBN-13 accepted',
  normalizeIsbn13('9781506747613') === '9781506747613')
check('hyphenated form normalises to the same identifier',
  normalizeIsbn13('978-1-5067-4761-3') === '9781506747613')
check('spaced form normalises to the same identifier',
  normalizeIsbn13('978 1 5067 4761 3') === '9781506747613')
check('mixed hyphens and spaces normalise',
  normalizeIsbn13(' 978-1 5067-4761 3 ') === '9781506747613')

// The four rows the audit found. Each is a real stored value that fails its
// own check digit — these must never again be accepted as identity.
for (const bad of ['9781527543248', '9781250981396', '9780702929432', '9781769657622']) {
  check(`audit defect ${bad} rejected (bad checksum)`, normalizeIsbn13(bad) === null)
}

check('979 prefix accepted (no ISBN-10 form, still a real ISBN)',
  normalizeIsbn13('9798855406481') === '9798855406481')
check('garbage rejected', normalizeIsbn13('notanisbn') === null)
check('empty rejected', normalizeIsbn13('') === null)
check('null rejected', normalizeIsbn13(null) === null)
check('undefined rejected', normalizeIsbn13(undefined) === null)
check('12 digits rejected (impossible length)', normalizeIsbn13('978150674761') === null)
check('14 digits rejected (impossible length)', normalizeIsbn13('97815067476133') === null)
check('non-digit inside rejected, not silently stripped',
  normalizeIsbn13('97815O6747613') === null)

console.log('\n── UPC / EAN must never be presented as an ISBN ──────────────')

// 5012345678900 is a checksum-VALID EAN-13 with a non-book prefix. The old
// edition.ts validator accepted it as an ISBN because it only checked the
// check digit. It is a perfectly good barcode and is not an ISBN.
check('checksum-valid non-book EAN-13 has a valid check digit (premise)',
  hasValidEan13Checksum('5012345678900'))
check('...but is NOT book-prefixed', !hasBookPrefix('5012345678900'))
check('...and is REJECTED as an ISBN', normalizeIsbn13('5012345678900') === null)
check('...and classifies as an EAN, not an ISBN',
  classifyBarcode('5012345678900').ean === '5012345678900' &&
  classifyBarcode('5012345678900').isbn13 === null)
check('12-digit UPC-A widens to an EAN, never an ISBN',
  classifyBarcode('012345678905').isbn13 === null)

console.log('\n── ISBN-10 handling ─────────────────────────────────────────')

check('valid ISBN-10 with X check digit converts',
  isbn10To13('097522980X') === '9780975229804')
check('lowercase x accepted', isbn10To13('097522980x') === '9780975229804')
check('ISBN-10 bad checksum rejected', isbn10To13('0975229801') === null)
check('hyphenated ISBN-10 converts', normalizeAnyIsbn('1-4215-1021-9') === '9781421510217')
check('ISBN-13 → ISBN-10 round-trips', isbn13To10('9780975229804') === '097522980X')
check('979 has NO ISBN-10 form — never fabricated',
  isbn13To10('9798855406481') === null)
check('normalizeAnyIsbn accepts both widths',
  normalizeAnyIsbn('9781506747613') === '9781506747613' &&
  normalizeAnyIsbn('097522980X')    === '9780975229804')

console.log('\n── ISBN is a STRING: leading zeroes survive ──────────────────')

// 9780306406157 is the canonical ISBN-13 worked example. The ISBN-10 form of
// a 978-0… ISBN starts with 0, which any numeric round-trip destroys.
const zeroLead = isbn13To10('9780306406157')
check('ISBN-10 with a leading zero is preserved', zeroLead === '0306406152', String(zeroLead))
check('leading zero survives normalisation',
  normalizeAnyIsbn('0306406152') === '9780306406157')
check('a numeric round-trip WOULD have destroyed it (premise)',
  String(Number('0306406152')) !== '0306406152')
check('13-digit value exceeds exact float digit precision (premise)',
  !Number.isSafeInteger(Number('9780306406157')) ||
   String(Number('9780306406157')) === '9780306406157')

console.log('\n── Ingestion: extractIdentifiers (every adapter uses this) ───')

check('valid barcode → isbn13',
  extractIdentifiers('9781506747613').isbn13 === '9781506747613')
check('ROOT CAUSE: 978-prefixed bad checksum is NO LONGER trusted',
  extractIdentifiers('9781250981396').isbn13 === null)
check('...and does not leak into the ean field either',
  extractIdentifiers('9781250981396').ean === null)
check('non-book EAN barcode → ean, not isbn13',
  extractIdentifiers('5012345678900').isbn13 === null &&
  extractIdentifiers('5012345678900').ean    === '5012345678900')
check('ISBN-10 SKU is no longer silently dropped',
  extractIdentifiers('097522980X').isbn13 === '9780975229804')
check('empty barcode yields nothing', extractIdentifiers('').isbn13 === null)
check('null barcode yields nothing', extractIdentifiers(null).isbn13 === null)
check('a Shopify variant id is not an identifier',
  extractIdentifiers('8093570203900').isbn13 === null)

console.log('\n── Single issues: no ISBN is an honest state, not a defect ───')

check('a single issue with no ISBN stays null — never invented',
  normalizeIsbn13(null) === null && normalizeAnyIsbn(null) === null)
check('an issue number is not an ISBN', normalizeIsbn13('1') === null)
check('a CV id is not an ISBN', normalizeIsbn13('796') === null)

console.log('\n── Edition walls hold (identity must not collapse) ───────────')

const pb = { isbn13: '9781779527226', title: 'Absolute Batman Vol. 1: The Zoo', format: 'TPB' }
const hc = { isbn13: '9781799507505', title: 'Absolute Batman Vol. 1: The Zoo', format: 'HARDCOVER' }
check('FORMAT COLLISION: paperback ISBN never applies to the hardcover',
  editionMatchVerdict(pb, hc).verdict === 'reject')

const v1 = { isbn13: '9781506747613', title: 'Lone Wolf and Cub Deluxe Edition Volume 1', format: 'DELUXE' }
const v2 = { isbn13: '9781506747620', title: 'Lone Wolf and Cub Deluxe Edition Volume 2', format: 'DELUXE' }
check('VOLUME COLLISION: Vol 1 ISBN is not inherited by Vol 2',
  editionMatchVerdict(v1, v2).verdict === 'reject')

const boxSet = { title: 'Saga Box Set Volumes 1-3', format: 'TPB' }
const single = { title: 'Saga Volume 1', format: 'TPB' }
check('BOX SET COLLISION: box set does not match an individual volume',
  editionMatchVerdict(boxSet, single).verdict === 'reject')

const omni = { title: 'Lone Wolf and Cub Omnibus Volume 1', format: 'OMNIBUS' }
const dlx  = { title: 'Lone Wolf and Cub Deluxe Edition Volume 1', format: 'DELUXE' }
check('OMNIBUS vs standard volume stays distinct',
  editionMatchVerdict(omni, dlx).verdict === 'reject')

check('DIGITAL vs physical stays distinct',
  editionMatchVerdict(
    { title: 'Saga Volume 1 Kindle Edition' },
    { title: 'Saga Volume 1' },
  ).verdict === 'reject')

check('SAME title + DIFFERENT ISBN is always a reject',
  editionMatchVerdict(
    { isbn13: '9781506747613', title: 'Same Title' },
    { isbn13: '9781506747620', title: 'Same Title' },
  ).verdict === 'reject')

check('identical ISBN is a match',
  editionMatchVerdict(
    { isbn13: '9781506747613', title: 'A' },
    { isbn13: '978-1-5067-4761-3', title: 'B' },
  ).verdict === 'match')

check('FUZZY TITLE alone never reaches match',
  editionMatchVerdict(
    { title: 'Hellboy Omnibus Volume 1', format: 'OMNIBUS' },
    { title: 'Hellboy Omnibus Volume 1', format: 'OMNIBUS' },
  ).verdict !== 'match')

console.log('\n── An INVALID ISBN cannot create a false exact match ─────────')

// Both sides carry the SAME invalid string. Before validation this read as
// "isbn13-exact" and merged two records on a typo.
const bogusA = { isbn13: '9781250981396', title: 'American Born Chinese', format: 'TPB' }
const bogusB = { isbn13: '9781250981396', title: 'Something Else Entirely', format: 'TPB' }
check('shared INVALID ISBN does not produce an isbn13-exact match',
  editionMatchVerdict(bogusA, bogusB).verdict !== 'match')

check('isValidIsbn13 agrees with normalizeIsbn13',
  isValidIsbn13('9781506747613') && !isValidIsbn13('9781250981396'))

console.log(
  failures === 0
    ? `\n✅ ISBN truth: all checks passed\n`
    : `\n❌ ISBN truth: ${failures} check(s) failed\n`,
)
process.exit(failures === 0 ? 0 : 1)
