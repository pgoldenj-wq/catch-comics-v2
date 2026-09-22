/**
 * test-product-relevance.ts — the product-page eBay edition boundary.
 *
 * Founder review raised it 2026-08-29; production confirmed it 2026-09-22.
 * /api/ebay?isbn=9781506706665&title=Hellboy%20omnibus returned eight offers
 * for Hellboy Omnibus Volume 1 and seven were a different book. These tests
 * encode the SHAPE of each failure, not the one title that exposed it.
 *
 * Run: npm run test:product-relevance
 */
import { listingMatchesProduct } from '@/lib/listings/productRelevance'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, extra = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`) }
}

console.log('\nThe eight rows production actually served for Hellboy Omnibus Vol. 1')
// Stored title is the generic "Hellboy omnibus" — our own catalogue holds TWO
// books under it (ISBN ...6665 and ...6672), both with volumeNumber null.
const PRODUCT = 'Hellboy omnibus'
const productionRows: Array<[string, number]> = [
  ['Hellboy Omnibus Volume 2 Strange Places Paperback Mignola', 14.42],
  ['HELLBOY Omnibus Volume 2 STRANGE PLACES Graphic Novel', 14.50],
  ['Hellboy Omnibus Volume 4 Hellboy In Hell Paperback', 17.63],
  ['Mike Mignola Hellboy Omnibus Volume 2 (Paperback)', 17.80],
  ['B.P.R.D. Plague OF Frogs Omnibus Volume One 1 Mike Mignola Guy Davis', 18.28],
  ['Hellboy Omnibus Vol 1 Seed of Destruction Dark Horse Mike Mignola', 19.36],
  ['Hellboy Omnibus Volume 2: Strange Places by Mike Mignola (Paperback)', 22.23],
  ['Mike Mignola Hellboy Omnibus Volume 4: Hellboy in Hell (Paperback)', 25.20],
]
const survivors = productionRows.filter(([t]) => listingMatchesProduct(t, PRODUCT))
check(`every row naming a volume our title cannot confirm is refused (${survivors.length} survive)`,
  survivors.length === 0, survivors.map(r => r[0]).join(' | '))
check('the cheapest row was Volume 2 and is refused',
  !listingMatchesProduct(productionRows[0][0], PRODUCT))
check('a different series sharing the word "omnibus" is refused',
  !listingMatchesProduct('B.P.R.D. Plague OF Frogs Omnibus Volume One 1', PRODUCT))

console.log('\nAn unverifiable edition claim is refused even when it is plausible')
// This row probably IS the book. "Probably" is not an identity, and ISBN
// ...6672 is stored under the same title, so we cannot say which one it is.
check('even a Vol 1 row is refused when our own title names no volume',
  !listingMatchesProduct('Hellboy Omnibus Vol 1 Seed of Destruction', 'Hellboy omnibus'))
check('a row naming no volume at all is kept — it makes no contrary claim',
  listingMatchesProduct('Hellboy Omnibus Seed of Destruction Dark Horse', 'Hellboy omnibus'))

console.log('\nWhen our title does name an edition, the matching one survives')
check('same volume is kept',
  listingMatchesProduct('Saga Volume 3 Image Comics Paperback', 'Saga Volume 3'))
check('a different volume is refused',
  !listingMatchesProduct('Saga Volume 5 Image Comics', 'Saga Volume 3'))
check('"Vol." and "Volume" are the same claim',
  listingMatchesProduct('Saga Vol. 3 by Brian K. Vaughan', 'Saga Volume 3'))
check('extra words in the listing do not disqualify it',
  listingMatchesProduct('Absolute Batman Volume 1 Hardcover DC Comics 2025', 'Absolute Batman Volume 1'))
check('case and punctuation do not matter',
  listingMatchesProduct('ABSOLUTE BATMAN, VOL. 1 — THE ZOO', 'Absolute Batman Volume 1'))

console.log('\nIssue numbers work the same way')
check('the same issue number is kept',
  listingMatchesProduct('Amazing Spider-Man #300 Marvel', 'Amazing Spider-Man #300'))
check('a different issue number is refused',
  !listingMatchesProduct('Amazing Spider-Man #301 Marvel', 'Amazing Spider-Man #300'))
check('an issue number we cannot confirm is refused',
  !listingMatchesProduct('Amazing Spider-Man #300 Marvel', 'Amazing Spider-Man'))

console.log('\nA set is not the book inside it')
check('a boxed set is refused for a single volume',
  !listingMatchesProduct('Hellboy Omnibus Boxed Set 4 Books', 'Hellboy omnibus'))
check('a slipcase edition is refused',
  !listingMatchesProduct('Saga Deluxe Slipcase Edition', 'Saga Deluxe'))
check('but a set IS kept when the set is what we are selling',
  listingMatchesProduct('Hellboy Omnibus Boxed Set Dark Horse', 'Hellboy Omnibus Boxed Set'))

console.log('\nContents are not an edition claim (live-audit regressions)')
// Every row below was refused by the first cut of this gate and is correct.
// A book that lists what it collects was being read as a different book.
check('"Collects Issues #1-6" does not make it a different volume',
  listingMatchesProduct('SAGA VOLUME 1 GRAPHIC NOVEL Paperback Collects Issues #1-6', 'Saga Volume 1'))
check('an omnibus naming the volumes inside it is still that omnibus',
  listingMatchesProduct('Shinji Makari Issak Omnibus 6 (Vol. 11-12) (Paperback)', 'Issak Omnibus Volume 6'))
check('a spelled-out edition number is the same number',
  listingMatchesProduct('Saga Volume One TPB (2012) Image Comics Brian K. Vaughan', 'Saga Volume 1'))
check('and a spelled-out number still has to be the RIGHT one',
  !listingMatchesProduct('Saga Volume Three TPB Image Comics', 'Saga Volume 1'))

console.log('\nThe wrong book stays refused (live-audit confirmations)')
check('a different title in the same imprint is refused',
  !listingMatchesProduct('ABSOLUTE MARTIAN MANHUNTER Volume 1 Graphic Novel', 'Absolute Batman Volume 1 The Zoo'))
check('a different manga volume is refused',
  !listingMatchesProduct('Chainsaw Man, Vol. 6: Boom Boom Boom: Volume 6', 'Chainsaw Man, Vol. 1 Volume 1'))
check('the right manga volume is kept',
  listingMatchesProduct('Tatsuki Fujimoto Chainsaw Man, Vol. 1 (Paperback)', 'Chainsaw Man, Vol. 1 Volume 1'))
check('an earlier volume is refused on a later volume’s page',
  !listingMatchesProduct('Chainsaw Man, Vol. 1 : 1', 'Chainsaw Man, Vol. 2 Volume 2'))

console.log('\nThe gate never guesses')
check('a product title of nothing but stopwords matches nothing',
  !listingMatchesProduct('Anything At All', 'The'))
check('an empty product title matches nothing',
  !listingMatchesProduct('Hellboy Omnibus', ''))
check('a missing word means it is not our book',
  !listingMatchesProduct('Omnibus Edition Dark Horse', 'Hellboy omnibus'))
check('a partial word does not satisfy a whole word',
  !listingMatchesProduct('Hell Omnibus', 'Hellboy omnibus'))

console.log(`\n${fail === 0 ? 'PRODUCT RELEVANCE: PASS' : 'PRODUCT RELEVANCE: FAIL'} — ${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
