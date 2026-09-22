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

/** A bare issue number, e.g. "#24". */
const ISSUE_NUMBER = /#\s*(\d{1,4})\b/

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

  // Edition discipline, as strict equality INCLUDING absence. A number the
  // listing names and ours does not is unverifiable; a number contradicting
  // ours is wrong; and a listing naming none, for a product that names one, is
  // just as unproven. The edition has to match, not merely fail to conflict.
  const pEd = editionNumberIn(productTitle)
  if (pEd !== editionNumberIn(listingTitle)) return false

  // Once the edition number agrees, identity is established and a stray issue
  // number is describing contents, not naming a different book.
  if (pEd !== null) return true

  // No edition number on either side: the issue number is then the only thing
  // that can distinguish two books, so it must agree exactly.
  return issueNumberIn(productTitle) === issueNumberIn(listingTitle)
}
