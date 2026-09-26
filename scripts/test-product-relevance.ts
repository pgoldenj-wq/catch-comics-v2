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
// This used to be KEPT on the grounds that it "makes no contrary claim". The
// final smoke test (2026-09-26) found production serving the next row below on
// the Omnibus Vol. 1 page: it names no number either, and it is a different
// book. Making no contrary claim is not the same as being this book.
check('a row naming no volume is refused too, when our title names none',
  !listingMatchesProduct('Hellboy Omnibus Seed of Destruction Dark Horse', 'Hellboy omnibus'))
check('the live wrong row — Monster Sized Hellboy HC — is refused',
  !listingMatchesProduct('MONSTER SIZED HELLBOY HARDCOVER (1512 Pages) Omnibus Hardback by Mike Mignola', 'Hellboy omnibus'))

console.log('\nA bare series name cannot anchor a keyword search (live 2026-09-26)')
// Whole stored titles of unrelated TPBs. Every row below was live on production,
// kept by the gate, and sorted into the price table — most of them as the
// cheapest offer — for books they are not.
for (const [listing, product] of [
  ['Marvel Avengers vs X-Men: AXIS Trade Paperback Graphic Novel 2015 Remender', 'X-Men'],
  ['Marvel Comics X-Men Fatal Attractions TPB 1992 Magneto Wolverine Quesada', 'X-Men'],
  ['Ultimate War #1-4 Complete Set Marvel 2003 Ultimates vs X-Men Millar Bachalo', 'X-Men'],
  ['(WK40) MIDNIGHT SPIDER-MAN #1A STEVE BEACH - PREORDER OCT 7TH', 'SPIDER-MAN'],
  ['🕷 Rare 🔥 With Free Gift Patch - Complete Spider-Man #1 - 1990 - Todd McFarlane', 'SPIDER-MAN'],
  ['Marvel Ultimate Spider-Man: Ultimatum TPB Marvel Premiere Ed CGC 9.4 2009', 'SPIDER-MAN'],
] as const) {
  check(`refused for "${product}": ${listing.slice(0, 48)}…`, !listingMatchesProduct(listing, product))
}

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
  listingMatchesProduct('Attack on Titan Season 1 Part 1 Manga Box Set Kodansha', 'Attack on Titan Season 1 Part 1 Manga Box Set'))
check('an unnumbered set title still cannot anchor a keyword hit',
  !listingMatchesProduct('Hellboy Omnibus Boxed Set Dark Horse', 'Hellboy Omnibus Boxed Set'))

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

console.log('\nA bare "<series> Vol N" is not any book that contains those words (live 2026-09-26)')
// Every REFUSED row was live on production and kept by the gate; several were
// the cheapest offer on the page. Every KEPT row is the right book, from the
// same live sample — the over-refusal side of the same rule.
for (const [listing, product] of [
  ['Invincible Iron Man: Volume 3: World\'s Most Wanted TPB - Marvel - 2009', 'Invincible, Volume 3'],
  ['Star Wars Darth Vader Vol. 3: War of the Bounty Hunters by Greg Pak', 'Star Wars Vol. 3'],
  ['Star Wars: The Old Republic Vol 3 The Lost Suns Colour Graphic Novel English', 'Star Wars Vol. 3'],
  ['Marvel Star Wars: The Empire Legends Omnibus Vol 3 Hardcover Graphic Novel', 'Star Wars Vol. 3'],
  ['Star Wars Epic Collection: Legacy Vol 3 TPB Marvel', 'Star Wars Vol. 3'],
  ['Berserk Deluxe Edition Volume 1', 'Berserk Volume 1'],
  ['Kentaro Miura Berserk Deluxe Volume 2 (Hardback)', 'Berserk Volume 2'],
  ['Kentaro Miura Berserk mangas volumes 1, 2 and 3 in good condition', 'Berserk Volume 1'],
  ['Berserk Deluxe Volumes 2 And 3', 'Berserk Volume 2'],
  ['Daredevil vol 1 no 260 (November 1988) - VERY GOOD condition - bagged, boarded', 'Daredevil Vol. 1'],
  ['Daredevil Vol 1 #236 238 248-250 Marvel Comics 1987 All In VFN/NM Condition', 'Daredevil Vol. 1'],
  ['Daredevil 230 Vol 1 1986 Born Again Arc Marvel Comics', 'Daredevil Vol. 1'],
  ['Daredevil Back in Black Vol 1 Chinatown Graphic Novel TPB Charles Soule', 'Daredevil Vol. 1'],
  ['Blade Runner 2029 Vol 1, 2 & 3 (NEW/MINT)', 'Blade Runner 2029 Vol. 1:'],
  ['Blade Runner Black Lotus + Blade Runner 2039 Vol 1 & 2 (NEW/MINT)', 'Blade Runner 2039 Vol. 1'],
  ['Masashi Kishimoto Naruto (3-in-1 Edition), Vol. 2 (Paperback)', 'Naruto, Vol. 2 Volume 2'],
  ['HELLBOY Omnibus Volume 1 SEED OF DESTRUCTION Graphic Novel', 'Hellboy Volume 1'],
  ['Hellboy Omnibus Volume 2 Strange Places Paperback Mignola', 'Hellboy Volume 2'],
  ['Hellboy Animated Volume 2: The Judgemen..., Pascoe, Jim', 'Hellboy Volume 2'],
  ['Hellboy Volume 1 And 2', 'Hellboy Volume 1'],
  // A different edition of the same story, with a subtitle that matches ours.
  ['HELLBOY Omnibus Volume 1 SEED OF DESTRUCTION Graphic Novel', 'Hellboy Volume 1: Seed of Destruction'],
  ['Hellboy Library Edition, Volume 1: Seed of Destruction and Wake the Devil', 'Hellboy Volume 1: Seed of Destruction'],
  ['Hellboy Volume 2 HC Mike Mignola LIBRARY EDITION', 'Hellboy Volume 2'],
  ['MONSTRESS VOLUME 3 DELUXE SIGNED LIMITED EDITION HARDCOVER Signed Limited to 500', 'Monstress Volume 3'],
] as const) {
  check(`refused for "${product}": ${listing.slice(0, 44)}…`, !listingMatchesProduct(listing, product))
}
for (const [listing, product] of [
  ['Robert Kirkman Invincible Volume 3: Perfect Strangers (Paperback) Invincible', 'Invincible, Volume 3'],
  ['INVINCIBLE Volume 3 - PERFECT STRANGERS [Paperback] (Covers Issues 9-13)', 'Invincible, Volume 3'],
  ['STAR WARS VOL 3 (Marvel) Hardback (Aaron, Larroca, Delgado)', 'Star Wars Vol. 3'],
  ['Berserk Volume 3 Kentaro Miura Manga Paperback Dark Horse Horror Fantasy', 'Berserk Volume 3'],
  ['Saga Graphic Novel Volume One Image Comics Brian K Vaughan', 'Saga Volume 1'],
  ['The Walking Dead Comic Volume 2 Miles Behind US', 'The Walking Dead Volume 2'],
  ['Image Comics The Walking Dead Volume 2 Graphic Novel.', 'The Walking Dead Volume 2'],
  ['THE WALKING DEAD Volume 2 collected issues 7-12 TPB book Image Comics Marvel DC', 'The Walking Dead Volume 2'],
  ['Chainsaw Man, Vol. 2', 'Chainsaw Man, Vol. 2 Volume 2'],
  ['Jed MacKay X-Men by Jed MacKay Vol. 1: Homecoming (Paperback)', 'X-Men Vol.1: Homecoming'],
  ['Saladin Ahmed Wolverine Vol. 1: In The Bones (Paperback)', 'Wolverine by Saladin Ahmed Vol. 1: In the Bones'],
  ['STAR WARS VOLUME 1 DESTINY PATH GRAPHIC NOVEL New Paperback Collects (2020) #1-6', 'Star Wars Vol. 1: The Destiny Path'],
  ['Hellboy Omnibus Volume 4 Hellboy In Hell Paperback', 'Hellboy Omnibus Volume 4: Hellboy in Hell'],
  ['Hellboy: Volume 1 - Seed of Destruction (Dark Horse Comics, Mike Mignola)', 'Hellboy Volume 1: Seed of Destruction'],
  ['Monstress Volume 3: Haven Marjorie Liu, Image Comics', 'Monstress Volume 3'],
  // A qualifier our own title carries is not a different edition.
  ['Absolute Batman Vol. 1: The Zoo (Absolute Universe) Paperback – 5 Aug. 2025', 'Absolute Batman Vol. 1: The Zoo'],
  ['Berserk Deluxe Edition Volume 1', 'Berserk Deluxe Volume 1'],
  // A word of our own title before the number is not a different book.
  ['ATTACK ON TITAN OMNIBUS TP VOL 01 VOL 1-3 (MR) (C: 1-1-0)', 'Attack on Titan Omnibus 1 (Vol. 1-3)'],
] as const) {
  check(`kept for "${product}": ${listing.slice(0, 44)}…`, listingMatchesProduct(listing, product))
}

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
