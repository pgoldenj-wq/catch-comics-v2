/**
 * test-listing-trust.ts — the "Other listings" product-truth boundary.
 *
 * Founder review 2026-08-31: /search?q=absolute+batman returned six unmatched
 * rows and not one of them was the product searched for. These tests encode the
 * SHAPE of each failure, not the one title that exposed it, so a different
 * comic with the same shape is covered too.
 *
 * Run: npm run test:listing-trust
 */
import { isLikelyComic, classifyText } from '@/lib/search/isLikelyComic'
import {
  listingMatchesQuery, significantTokens, volumeNumberIn, issueNumberIn,
} from '@/lib/search/listingRelevance'
import { isTrustedPrice, MIN_TRUSTED_PRICE } from '@/lib/listings/trustedPrice'

let pass = 0, fail = 0
const check = (name: string, ok: boolean, extra = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`) }
}

/** The whole gate as the queries apply it, so tests exercise the real order. */
const trusted = (title: string, price: unknown, query: string) =>
  listingMatchesQuery(title, query) && isLikelyComic(title) && isTrustedPrice(price)

console.log('\nThe exact edition the shopper asked for survives')
check('an exact title match with a real price is kept',
  trusted('Absolute Batman Vol. 1: The Zoo', 24.99, 'absolute batman'))
check('extra words in the listing title do not disqualify it',
  trusted('Absolute Batman Volume 1 Hardcover DC Comics', 30, 'absolute batman'))
check('a different comic entirely works the same way',
  trusted('Saga Volume 3 Image Comics', 12.5, 'saga volume 3'))
check('and so does a manga',
  trusted('Chainsaw Man Volume 5 Manga Viz', 7.99, 'chainsaw man volume 5'))
check('case and punctuation do not matter',
  trusted('ABSOLUTE BATMAN, VOL. 1 — THE ZOO', 24.99, 'Absolute Batman'))

console.log('\nTitle similarity alone is rejected')
// The row that started this: shares one word, is not the product.
check('a book sharing one query word is rejected',
  !trusted('Sewing for Absolute Beginners', 6.69, 'absolute batman'))
check('a trigram lookalike is rejected',
  !trusted('Absolutely Fabulous', 6.69, 'absolute batman'))
check('a bare franchise title does not answer a specific query',
  !trusted('Batman', 5.0, 'absolute batman'))
check('the same shape on a different franchise',
  !trusted('Knitting for Complete Beginners', 5.0, 'complete spider-man'))
check('a token may not match as a prefix of a longer word',
  !listingMatchesQuery('Batmania: A History', 'bat'))
check('an empty or stopword-only query trusts nothing',
  !listingMatchesQuery('Absolute Batman', 'the of and'))

console.log('\nThe wrong volume or issue is rejected')
check('another volume is rejected',
  !trusted('Absolute Batman Vol. 2: Abomination', 24.99, 'absolute batman vol 1'))
check('the right volume is kept',
  trusted('Absolute Batman Vol. 1: The Zoo', 24.99, 'absolute batman vol 1'))
check('another issue number is rejected',
  !trusted('Absolute Batman #24 Comics', 4.1, 'absolute batman #23'))
check('the right issue number is kept',
  trusted('Absolute Batman #23 Comics', 4.1, 'absolute batman #23'))
check('a listing that names no volume still answers an unnumbered query',
  trusted('Absolute Batman Comics', 20, 'absolute batman'))
check('volume numbers are read from either spelling',
  volumeNumberIn('Saga, Volume 4') === 4 && volumeNumberIn('Saga Vol. 4') === 4)
check('issue numbers are read from the hash form', issueNumberIn('Batman #607') === 607)
check('significant tokens drop stopwords and format noise',
  significantTokens('the absolute batman comic book').join(',') === 'absolute,batman')

console.log('\nNon-comic media is rejected')
check('a DVD is not a comic', !trusted('Batman vs. Two-Face (DVD)', 5.99, 'batman'))
check('a Blu-ray is not a comic', !trusted('The Dark Knight Blu-ray', 9.99, 'dark knight'))
check('a soundtrack is not a comic', !trusted('Batman Original Score Vinyl', 19.99, 'batman'))
check('a video game is not a comic', !trusted('Batman Arkham Knight PS4 Video Game', 15, 'batman'))
check('a toy is not a comic', !trusted('Batman Action Figure 12 inch', 22, 'batman'))
check('a calendar is not a comic', !trusted('Batman Calendar 2027', 8.99, 'batman'))
check('media flags beat comic signals', classifyText('Batman Comics DVD') === 'non-comic')
check('a real comic with a similar name is untouched',
  trusted('Batman: The Dark Knight Returns', 14.99, 'batman dark knight'))

console.log('\nA £0.00 stub is never a price')
check('zero is rejected', !isTrustedPrice(0))
check('a zero string from Prisma Decimal is rejected', !isTrustedPrice('0.00'))
check('negative is rejected', !isTrustedPrice(-1))
check('null and undefined are rejected', !isTrustedPrice(null) && !isTrustedPrice(undefined))
check('NaN and Infinity are rejected', !isTrustedPrice(NaN) && !isTrustedPrice(Infinity))
check('a penny is a price', isTrustedPrice(MIN_TRUSTED_PRICE))
check('a decimal string from Prisma is a price', isTrustedPrice('12.50'))
check('a correct comic at £0.00 is still rejected — the price is the problem',
  !trusted('Absolute Batman Vol. 1: The Zoo', 0, 'absolute batman'))

console.log('\nThe six rows the founder actually saw')
const founderRows: Array<[string, number]> = [
  ['Batman', 0], ['Batman', 0], ['Absolutely Fabulous', 6.69],
  ['Batman', 0], ['Batman vs. Two-Face (DVD)', 0], ['Sewing for Absolute Beginners', 0],
]
const survivors = founderRows.filter(([t, p]) => trusted(t, p, 'absolute batman'))
check(`all six junk rows are now rejected (${survivors.length} survive)`,
  survivors.length === 0, survivors.map(r => r[0]).join(', '))
check('and a genuine row in the same result set would still be kept',
  trusted('Absolute Batman Vol. 1 The Zoo DC Comics', 24.99, 'absolute batman'))

console.log(`\n${fail === 0 ? 'LISTING TRUST: PASS' : 'LISTING TRUST: FAIL'} — ${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
