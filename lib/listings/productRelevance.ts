/**
 * lib/listings/productRelevance.ts — whether a TITLE-DERIVED eBay listing is
 * actually the edition this product page is about.
 *
 * Founder review 2026-08-29 raised it; 2026-09-22 confirmed it live in
 * production. /api/ebay searches by ISBN first — precise, edition-anchored —
 * and then, whenever the ISBN returns fewer than three rows, merges in a plain
 * keyword search for the product's title. Nothing checked what came back. The
 * merged rows were then sorted by price ascending, so the cheapest of them led
 * the price table.
 *
 * For /product/hellboy-omnibus-706665 (Hellboy Omnibus Volume 1, ISBN
 * 9781506706665) production returned, in display order:
 *
 *   £14.42  Hellboy Omnibus Volume 2 Strange Places      ← a different book
 *   £14.50  HELLBOY Omnibus Volume 2 STRANGE PLACES      ← a different book
 *   £17.63  Hellboy Omnibus Volume 4 Hellboy In Hell     ← a different book
 *   £17.80  Mike Mignola Hellboy Omnibus Volume 2        ← a different book
 *   £18.28  B.P.R.D. Plague of Frogs Omnibus Volume One  ← a different SERIES
 *   £19.36  Hellboy Omnibus Vol 1 Seed of Destruction    ← the actual book, 6th
 *   £22.23  Hellboy Omnibus Volume 2: Strange Places     ← a different book
 *   £25.20  Hellboy Omnibus Volume 4: Hellboy in Hell    ← a different book
 *
 * Seven of eight were the wrong book, the page quoted "from £14.42" for a book
 * that costs £19.36, and a shopper following the cheapest offer bought Volume 2.
 * That is the exact opposite of what a price-comparison page is for.
 *
 * Why the search-side gate (lib/search/listingRelevance) is not enough here:
 * it asks whether a listing answers the words a SHOPPER TYPED, and deliberately
 * lets a listing naming a number pass when the query named none — "Absolute
 * Batman Vol. 1" is a fair answer to "absolute batman". On a product page the
 * question is stricter: this listing must be THIS EDITION. Our own catalogue
 * makes that plain — ISBN 9781506706665 and 9781506706672 are two different
 * books both stored with the title "Hellboy omnibus", both with volumeNumber
 * null. When our own title cannot tell two editions apart, a keyword search for
 * that title cannot either, and the honest answer is to price neither.
 *
 * Applies ONLY to title-derived rows. ISBN-anchored rows are never gated.
 *
 * Calibrated against live production offers (npm run audit:ebay-relevance).
 * That audit is the reason for the contents-stripping below: a first cut read
 * "Collects Issues #1-6" and "Issak Omnibus 6 (Vol. 11-12)" as claims about
 * WHICH book was for sale, when they describe what is inside it, and refused
 * correct listings. Editions are numbered; contents are ranged.
 *
 * Pure string functions: no I/O, no React, testable on their own.
 */

import { significantTokens } from '@/lib/search/listingRelevance'

/**
 * Packaging that makes a listing a different product from the book itself.
 * "Hellboy Omnibus Boxed Set" is its own catalogue entry (ISBN 9781506725970);
 * selling it as the price of one volume misprices the book several times over.
 */
const SET_PACKAGING = /\b(?:box(?:ed)?[\s-]?set|slip[\s-]?case[d]?|collection set|complete series)\b/i

/**
 * Words that do nothing but introduce an edition number. "Vol. 3" and
 * "Volume 3" are the same claim, so requiring the literal word would refuse a
 * correct listing for spelling it differently. The NUMBER is what is compared.
 */
const EDITION_WORDS = new Set(['vol', 'vols', 'volume', 'volumes', 'part', 'parts', 'omnibus'])

/** Sellers spell small edition numbers as words at least as often as digits. */
const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
}

const NUMBER_WORD = Object.keys(WORD_NUMBERS).join('|')

/**
 * "Vol. 3", "Volume Three", "Omnibus 6", "Book 2" — a word that introduces an
 * edition, followed by its number. `omnibus` is here because manga omnibuses
 * are numbered exactly this way ("Issak Omnibus 6").
 */
const EDITION_NUMBER = new RegExp(
  `\\b(?:vol|vols|volume|volumes|book|part|omnibus)\\b\\.?\\s*(\\d{1,3}|${NUMBER_WORD})\\b`, 'i',
)

/**
 * An issue number: "#24", "#1A" (a variant of #1), "no 260", "No. 5". Sellers of
 * back issues write "Daredevil vol 1 no 260" — volume 1 of the SERIES, issue
 * 260 — which is not the "Daredevil Vol. 1" trade paperback.
 */
const ISSUE_NUMBER = /(?:#|\bno\.?)\s*(\d{1,4})(?!\d)/i

/**
 * Two or more editions in one listing: "Vol 1 & 2", "Vol 1, 2 & 3",
 * "Volumes 2 And 3". A bundle is not the one book on this page, and its first
 * number would otherwise pass for ours. (Ranges are stripped as contents
 * first, so "Vol. 11-12" inside an omnibus title is not caught here.)
 */
const MULTI_EDITION = new RegExp(
  `\\b(?:vol|vols|volume|volumes|book|books|part|parts)\\b\\.?\\s*(?:\\d{1,3}|${NUMBER_WORD})\\s*(?:,|&|\\+|\\band\\b)\\s*(?:(?:vol|volume|book|part)s?\\b\\.?\\s*)?(?:\\d{1,3}|${NUMBER_WORD})\\b`, 'i',
)

/**
 * Words that make a listing a different EDITION of the same story. "Hellboy
 * Omnibus Volume 1 Seed of Destruction" and "Hellboy Library Edition, Volume 1"
 * contain every word of "Hellboy Volume 1: Seed of Destruction", and neither is
 * that paperback. A qualifier in the listing that our own title does not carry
 * is a different book. (Hardcover/paperback is deliberately absent: our titles
 * rarely state the binding, so it cannot be compared from the title alone.)
 */
const EDITION_QUALIFIERS = [
  'deluxe', 'library', 'omnibus', 'compendium', 'absolute', 'treasury', 'oversized',
  'facsimile', 'signed', 'limited', 'epic',
]
const N_IN_ONE = /\b\d\s+in\s+\d\b/   // "3-in-1" after fold()

/**
 * Words a seller puts between a series name and its volume number that do not
 * make it a different book: "Saga Graphic Novel Volume One", "The Walking Dead
 * Comic Volume 2". Deliberately short. "Deluxe", "Omnibus", "Iron Man" and
 * "Darth Vader" are NOT here — each of those names a different book.
 */
const NEUTRAL_BEFORE_EDITION = new Set([
  'the', 'a', 'an', 'of', 'graphic', 'novel', 'novels', 'gn', 'tpb', 'tp', 'trade',
  'paperback', 'softcover', 'hardcover', 'hardback', 'hc', 'comic', 'comics', 'manga',
  'edition', // on its own it names nothing; "Deluxe Edition" is refused by EDITION_QUALIFIERS
])

/**
 * What a listing says is INSIDE the book, which is not a claim about which book
 * it is. "Collects Issues #1-6" and "(Vol. 11-12)" describe contents; read as
 * edition numbers they refuse the very book they describe. Ranges are the tell.
 */
const CONTENTS_PHRASES = /\bcollect(?:s|ed|ing)?\b[^.,;)]*/gi
const NUMBER_RANGE = /\b\d{1,4}\s*(?:[-‒-―]|to)\s*\d{1,4}\b/gi

/** Remove contents descriptions so only edition claims remain. */
function withoutContents(title: string): string {
  return String(title ?? '')
    .replace(CONTENTS_PHRASES, ' ')
    .replace(NUMBER_RANGE, ' ')
}

const fold = (s: string) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[’']/g, '')          // o'neil -> oneil
    .replace(/[^a-z0-9]+/g, ' ')   // punctuation is not signal
    .trim()

/** The edition number a title names, or null. Digits or number-words. */
export function editionNumberIn(text: string): number | null {
  const m = EDITION_NUMBER.exec(withoutContents(text))
  if (!m) return null
  const raw = m[1].toLowerCase()
  return /^\d+$/.test(raw) ? Number(raw) : (WORD_NUMBERS[raw] ?? null)
}

/** The issue number a title names (#24), or null. */
export function issueNumberIn(text: string): number | null {
  const m = ISSUE_NUMBER.exec(withoutContents(text))
  return m ? Number(m[1]) : null
}

/**
 * For a title that is nothing but "<series> Vol N" — no subtitle after the
 * number — the words a listing may put directly before ITS number: the words
 * that name our series (numbers included, "Blade Runner 2039 Vol. 1"), plus any
 * other word of our own title ("Attack on Titan Omnibus 1" is sold as "...
 * OMNIBUS TP VOL 01"). Null when the title has no edition number or carries a
 * subtitle (the subtitle then identifies the book, and the every-word rule
 * already demands it).
 */
function bareSeriesWords(productTitle: string): Set<string> | null {
  const s = withoutContents(productTitle)
  const m = EDITION_NUMBER.exec(s)
  if (!m) return null
  const after = significantTokens(s.slice(m.index + m[0].length))
    .filter(t => !EDITION_WORDS.has(t) && !/^\d+$/.test(t) && !(t in WORD_NUMBERS))
  if (after.length > 0) return null
  const series = significantTokens(s.slice(0, m.index)).filter(t => !EDITION_WORDS.has(t))
  const ownWords = fold(productTitle).split(' ').filter(w => w && !/^\d+$/.test(w))
  return new Set([...series, ...ownWords])
}

/**
 * The last word before the listing's own edition number, skipping format words
 * ("Graphic Novel", "TPB"). For "Invincible Iron Man: Volume 3" that is "man";
 * for "Robert Kirkman Invincible Volume 3" it is "invincible".
 */
function wordBeforeEdition(listingTitle: string): string | null {
  const s = withoutContents(listingTitle)
  const m = EDITION_NUMBER.exec(s)
  if (!m) return null
  const words = fold(s.slice(0, m.index)).split(' ').filter(Boolean)
  for (let i = words.length - 1; i >= 0; i--) {
    if (!NEUTRAL_BEFORE_EDITION.has(words[i])) return words[i]
  }
  return null
}

/**
 * Is this title-derived listing trustworthy as an offer for THIS product?
 *
 * @param listingTitle the eBay listing's own title
 * @param productTitle the canonical product's stored title
 */
export function listingMatchesProduct(listingTitle: string, productTitle: string): boolean {
  const tokens = significantTokens(productTitle).filter(t => !EDITION_WORDS.has(t))
  if (tokens.length === 0) return false      // nothing to stand on; do not guess

  // Every meaningful word of OUR title must be in THEIRS, as a whole word.
  // This is what refuses "B.P.R.D. Plague of Frogs" for a Hellboy product, and
  // "Absolute Martian Manhunter" for an Absolute Batman one.
  const t = ` ${fold(listingTitle)} `
  for (const tok of tokens) {
    if (!t.includes(` ${tok} `)) return false
  }

  // A set is not the book inside it — unless we are actually selling the set.
  if (SET_PACKAGING.test(listingTitle) && !SET_PACKAGING.test(productTitle)) return false

  // Nor is a deluxe, library, omnibus or 3-in-1 edition the plain one.
  const p = ` ${fold(productTitle)} `
  for (const q of EDITION_QUALIFIERS) {
    if (t.includes(` ${q} `) && !p.includes(` ${q} `)) return false
  }
  if (N_IN_ONE.test(t) && !N_IN_ONE.test(p)) return false

  // Our title has to be able to name ONE book before a keyword hit can be
  // priced as it. A title with no edition number and no issue number cannot:
  // "Hellboy omnibus" is stored for two different ISBNs, and "X-Men" and
  // "SPIDER-MAN" are the whole stored titles of unrelated trade paperbacks.
  // The final smoke test (2026-09-26) found production pricing exactly these
  // pages with other books: "MONSTER SIZED HELLBOY HARDCOVER" on Omnibus Vol.
  // 1, "Avengers vs X-Men: AXIS" as the cheapest offer for an X-Men TPB, a
  // £873.70 1990 Spider-Man #1 on a Spider-Man treasury edition. None of them
  // named a contrary number, so the rules below had nothing to refuse. For
  // these products only the ISBN-anchored rows (never gated) are offers.
  const pEd = editionNumberIn(productTitle)
  if (pEd === null && issueNumberIn(productTitle) === null) return false

  // Edition discipline, as strict equality INCLUDING absence. A number the
  // listing names and ours does not is unverifiable; a number contradicting
  // ours is wrong; and a listing naming none, for a product that names one, is
  // just as unproven. The edition has to match, not merely fail to conflict.
  if (pEd !== editionNumberIn(listingTitle)) return false

  // A bundle of volumes is not one of them — "Blade Runner 2029 Vol 1, 2 & 3"
  // named Vol. 1 first and passed as the Vol. 1 paperback.
  if (MULTI_EDITION.test(withoutContents(listingTitle)) && !MULTI_EDITION.test(withoutContents(productTitle))) return false

  // "<series> Vol N" with nothing after the number names the series only by
  // the words before it — so the listing's word before ITS number must be one
  // of ours. Every word of "Invincible Volume 3" is in "Invincible Iron Man
  // Volume 3", and production priced the Iron Man book as the cheapest offer
  // for Invincible. Likewise "Star Wars Darth Vader Vol. 3" for "Star Wars
  // Vol. 3" and "Berserk Deluxe Volume 1" for "Berserk Volume 1".
  if (pEd !== null) {
    const series = bareSeriesWords(productTitle)
    if (series) {
      const before = wordBeforeEdition(listingTitle)
      if (!before || !series.has(before)) return false
    }
  }

  // The issue number must agree exactly, including absence. Contents ranges are
  // already stripped, so an issue number left in a listing is a claim about
  // which item it is: "Daredevil vol 1 no 260" is a 1988 single issue, not the
  // "Daredevil Vol. 1" trade paperback.
  return issueNumberIn(productTitle) === issueNumberIn(listingTitle)
}
