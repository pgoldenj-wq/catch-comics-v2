/**
 * lib/identity/comicShape.ts — is this CANONICAL product comic-shaped?
 * (Bookshop full-sync trust gate, 2026-07-16.)
 *
 * Purpose: general bookstore feeds (Bookshop.org sells everything) exact-ISBN
 * match some pre-existing NON-comic canonicals (cookbooks, biographies) that
 * entered the catalogue via earlier book-feed imports. Refreshing their prices
 * extends the freshness of catalogue pollution. This gate decides, from the
 * CANONICAL's own metadata, whether a matched product may be refreshed.
 *
 * ⚠ The format enum is NOT evidence. First-run samples proved format
 * assignments are contaminated by title-keyword inference: "Poppy Cooks …
 * Cookbook" = HARDCOVER, "Iron Maiden – Deluxe Edition" = DELUXE, "Mangal II:
 * Stories and Recipes" = MANGA_VOLUME ("Mangal" substring-matched 'manga').
 * Substring signals are equally unsafe — strong title words are matched on
 * WORD BOUNDARIES here.
 *
 * Evidence order — uncertain is always rejected, never guessed:
 *   1. comicvineId present               → comic     (verified by the CV matcher)
 *   2. curated negative flag in text     → non-comic (classifyText 'non-comic';
 *                                                     dominant over everything
 *                                                     except a CV match)
 *   3. publisher ∈ COMIC_PUBLISHERS_EXACT → comic    (exact-match, high precision)
 *   4. \b-bounded comic format word in title → comic ("graphic novel", "manga",
 *                                                     "comics", "tpb", …)
 *   5. otherwise                          → uncertain (REJECTED)
 *
 * Deliberately strict: a real comic with no CV link, a non-exact publisher and
 * no format word in its title is rejected (missing data — safe). A cookbook
 * refreshed as a comic is wrong data — unsafe. Pure function, no I/O.
 * Tests: scripts/test-edition-identity.ts (npm run test:identity).
 */

import { classifyText, COMIC_PUBLISHERS_EXACT } from '../search/isLikelyComic'

export interface CanonicalShape {
  format: string
  comicvineId?: string | null
  publisher?: string | null
  title: string
}

export type CanonicalComicVerdict = 'comic' | 'non-comic' | 'uncertain'

// Word-boundary comic format terms. \b prevents the "Mangal"→'manga' class of
// substring false positives. Iconic character names are intentionally absent —
// "Batman and Philosophy" is a prose book.
const STRONG_FORMAT_WORDS =
  /\b(comic|comics|graphic novel|graphic novels|manga|manhwa|manhua|tpb|trade paperback|bande dessinée)\b/i

export function classifyCanonicalComicShape(c: CanonicalShape): CanonicalComicVerdict {
  // 1. ComicVine-matched by the enrichment pipeline — strongest evidence.
  if (c.comicvineId) return 'comic'

  // 2. Curated negative flags (cookbook, study guide, self-help, …) dominate
  //    every remaining signal: "A Cookbook of Marvel Recipes" is not a comic.
  const text = `${c.title} ${c.publisher ?? ''}`
  if (classifyText(text) === 'non-comic') return 'non-comic'

  // 3. Exact comics-publisher match (normalised lowercase).
  const pub = c.publisher?.toLowerCase().trim()
  if (pub && COMIC_PUBLISHERS_EXACT.has(pub)) return 'comic'

  // 4. Word-bounded comic format term in the title.
  if (STRONG_FORMAT_WORDS.test(c.title)) return 'comic'

  // 5. Everything else — including records whose format ENUM claims comic —
  //    stays uncertain and is rejected. Format is display metadata here, not
  //    refresh evidence (see header).
  return 'uncertain'
}

/** Gate predicate: only 'comic' may be refreshed. Uncertain is rejected. */
export function isRefreshableComicCanonical(c: CanonicalShape): boolean {
  return classifyCanonicalComicShape(c) === 'comic'
}
