/**
 * lib/search/listingRelevance.ts — whether an UNMATCHED listing is actually
 * about what the shopper asked for.
 *
 * Founder review 2026-08-31. "Other listings" and "From eBay" hold rows with no
 * product identity at all: `canonical_product_id IS NULL` means precisely that
 * nothing tied them to a known edition. The only link to the query was
 * Postgres `similarity(title, q) > 0.2` — trigram overlap — and for
 * "absolute batman" that returned, in full:
 *
 *   Batman · Batman · Batman            (bare titles, no edition, £0.00)
 *   Absolutely Fabulous                 (trigram hit on "absolute")
 *   Batman vs. Two-Face (DVD)           (not a comic at all)
 *   Sewing for Absolute Beginners       (shares one word)
 *
 * Six rows, none of them the thing the shopper searched for. Trigram distance
 * measures how alike two strings LOOK, which is not a claim about the product.
 *
 * The rule here is deliberately blunt and readable: every meaningful word the
 * shopper typed has to actually be in the title, and a volume number they named
 * has to be the volume number they get. It cannot establish edition identity —
 * nothing can, for a row that has none — but it does refuse the two ways a
 * wrong product got in: sharing one word, and being a different volume.
 *
 * Pure string functions: no I/O, no React, testable on their own.
 */

/** Words that carry no product meaning, so requiring them would reject good rows. */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'the', 'of', 'or', 'for', 'to', 'in', 'on', 'by', 'with',
  'new', 'comic', 'comics', 'book', 'books', 'edition',
])

/** Words that mean "volume" so a number attached to them can be compared. */
const VOLUME_WORDS = /\b(?:vol|vols|volume|book|part)\b\.?\s*(\d{1,3})\b/i
/** A bare issue number, e.g. "#24". */
const ISSUE_NUMBER = /#\s*(\d{1,4})\b/

const fold = (s: string) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[’']/g, '')          // o'neil -> oneil
    .replace(/[^a-z0-9]+/g, ' ')   // punctuation is not signal
    .trim()

/**
 * The words a title has to contain. Stopwords and one-character fragments are
 * dropped; a query of nothing but stopwords yields no requirement, and the
 * caller should then fall back to rejecting rather than matching everything.
 */
export function significantTokens(query: string): string[] {
  return fold(query).split(' ').filter(t => t.length > 1 && !STOPWORDS.has(t))
}

/** The volume number a string names, or null. */
export function volumeNumberIn(text: string): number | null {
  const m = VOLUME_WORDS.exec(String(text ?? ''))
  if (m) return Number(m[1])
  return null
}

/** The issue number a string names (#24), or null. */
export function issueNumberIn(text: string): number | null {
  const m = ISSUE_NUMBER.exec(String(text ?? ''))
  return m ? Number(m[1]) : null
}

/**
 * Is this listing title a trustworthy answer to this query?
 *
 * Every significant query word must appear in the title, and where the shopper
 * named a volume or issue number the title must not name a different one. A
 * title that names no number at all still passes: "Absolute Batman" legitimately
 * answers "absolute batman", and refusing it would empty the rail for the sake
 * of a number the shopper did not ask for.
 */
export function listingMatchesQuery(title: string, query: string): boolean {
  const tokens = significantTokens(query)
  if (tokens.length === 0) return false      // nothing to stand on; do not guess

  // Whole words only. fold() has already reduced both sides to space-separated
  // words, so the padded form is an exact word test — "bat" must not be allowed
  // to satisfy itself against "batman".
  const t = ` ${fold(title)} `
  for (const tok of tokens) {
    if (!t.includes(` ${tok} `)) return false
  }

  // A number the shopper named must not come back as a different one. Vol. 2 is
  // a different book from Vol. 1, and a box set is not the volume inside it.
  const qVol = volumeNumberIn(query), tVol = volumeNumberIn(title)
  if (qVol !== null && tVol !== null && qVol !== tVol) return false
  const qIss = issueNumberIn(query), tIss = issueNumberIn(title)
  if (qIss !== null && tIss !== null && qIss !== tIss) return false

  return true
}
