/**
 * isLikelyComic() — heuristic comic-relevance filter for unmatched retailer
 * listings and loose marketplace results.
 *
 * Background: general book retailers (World of Books, Bookshop.org, Wordery)
 * feed their entire catalogue into retailer_listings — cookbooks, textbooks,
 * fiction novels, Latin school texts, German poetry collections. A sample of
 * 30 unmatched WoB listings showed ~97% non-comic pollution.
 *
 * Strategy: positive signals from comic-specific vocabulary and publishers,
 * negative signals from book-only categories. Confidence threshold gates
 * results before they reach the search UI.
 *
 * This is intentionally permissive on the positive side (we'd rather show
 * a fiction novel that mentions "Volume 1" than hide a real comic). Tighten
 * NON_COMIC_FLAGS if non-comics slip through.
 */

const COMIC_SIGNALS: readonly string[] = [
  // Comic-specific format/structure terms
  'comic', 'comics', 'graphic novel', 'manga',
  'omnibus', 'tpb', 'trade paperback', 'compendium',
  'hardcover collecting', 'deluxe edition', 'absolute',
  'one-shot', 'one shot', 'annual', 'free comic book day',
  'variant', 'variant cover',
  // Issue-number patterns
  'vol.', 'volume ', 'volume:', '#1', '#2', '#3', '#4', '#5',
  // Major comic publishers
  'marvel', 'dc comics', 'image comics', 'image comic',
  'dark horse', 'idw', 'boom!', 'boom studios',
  'titan comics', 'titan books', 'oni press', 'fantagraphics',
  'aftershock', 'vault comics', 'valiant',
  // Manga publishers
  'viz media', 'viz', 'kodansha', 'yen press', 'seven seas',
  'tokyopop', 'shueisha', 'shogakukan', 'square enix manga',
  // Iconic character/series names (catches "Batman: Year One" without "comic")
  'batman', 'superman', 'spider-man', 'spiderman', 'x-men',
  'wonder woman', 'green lantern', 'flash', 'justice league',
  'avengers', 'fantastic four', 'iron man', 'thor', 'hulk',
  'deadpool', 'wolverine', 'captain america', 'punisher',
  'daredevil', 'teenage mutant ninja turtles', 'tmnt',
  'transformers', 'star wars: ',
  // Well-known indie/literary comics
  'watchmen', 'sandman', 'saga', 'invincible', 'walking dead',
  'sin city', 'preacher', 'hellboy', 'maus',
]

const NON_COMIC_FLAGS: readonly string[] = [
  // Academic / reference
  'cookbook', 'recipe book', 'textbook', 'workbook', 'study guide',
  'dictionary', 'thesaurus', 'encyclopedia', 'handbook',
  // Lifestyle / non-fiction
  'self-help', 'self help', 'memoir', 'biography', 'autobiography',
  'travel guide', 'guidebook',
  // Specifically academic editions WoB sells in bulk
  'edited for schools', 'for schools and colleges',
  'lectures on', 'introduction to', 'principles of',
  // Latin/Greek classical texts (heavily over-represented in WoB feed)
  'm. tulli ciceronis', 'm.tullii ciceronis', 'c. iulii caesaris',
  'bellum gallicum', 'bellum catilinae', 'de amicitia', 'cato major',
  // Foreign-language indicators (high false-positive rate from WoB)
  'gesammelte schriften', 'gesammelte werke', 'auflage',
  'généalogies', 'satires',
  // Religious/philosophical that aren't comics
  'theology', 'theological', 'reformation',
]

// ── Classifier ────────────────────────────────────────────────────────────────

export type ComicClassification = 'comic' | 'non-comic' | 'uncertain'

/**
 * Three-state classifier — returns 'non-comic' when a NON_COMIC_FLAG matches,
 * 'comic' when a COMIC_SIGNAL matches without any non-comic flag, otherwise
 * 'uncertain'. The cleanup script uses this directly; isLikelyComic() below
 * collapses 'comic' → true and the other two → false for the search filter.
 *
 * Accepts a single text input — callers can concatenate title + publisher
 * (e.g. `${title} ${publisher ?? ''}`) so publisher signals (Marvel, DC, etc.)
 * help classify products whose title alone is ambiguous.
 */
export function classifyText(text: string): ComicClassification {
  if (!text) return 'uncertain'
  const t = text.toLowerCase()

  // Non-comic flag is dominant — anything matching a hard negative is rejected
  // regardless of other signals (e.g. "A Cookbook of Marvel Recipes" → non-comic).
  for (const flag of NON_COMIC_FLAGS) {
    if (t.includes(flag)) return 'non-comic'
  }

  for (const signal of COMIC_SIGNALS) {
    if (t.includes(signal)) return 'comic'
  }

  return 'uncertain'
}

/**
 * Returns true if a listing title looks like a comic. Conservative: requires
 * at least ONE positive signal AND zero strong negative signals. Uncertain
 * titles return false — better to lose a real comic than show pollution in
 * search results.
 */
export function isLikelyComic(title: string): boolean {
  return classifyText(title) === 'comic'
}

// Re-export constants for tooling (cleanup script, audits)
export { COMIC_SIGNALS, NON_COMIC_FLAGS }

// ── Enrichment-only signal list ───────────────────────────────────────────────
//
// classifyTextForEnrichment was introduced and then reverted on the same day:
// stripping 'volume '/'vol.' from the signal list cut pool coverage too
// aggressively (~9 of 21 previously-correct matches got filtered before any
// CV call). The matcher's R1/R2 gates (one-issue+no-publisher reject,
// short-title+no-publisher reject) handle the wrong-match patterns on their
// own without sacrificing coverage.
//
// Kept as a separate export so callers can be tightened independently in the
// future without touching the search-time path. Currently identical to
// classifyText.

export function classifyTextForEnrichment(text: string): ComicClassification {
  return classifyText(text)
}

// ── Strict signals (Bucket B+ classifier) ─────────────────────────────────────
//
// COMIC_SIGNALS above is permissive — it includes generic terms like 'vol.',
// 'volume ', 'omnibus', 'annual' that catch many non-comics by accident
// (poetry omnibuses, financial annuals, biography "Volume 1" series).
//
// STRONG_COMIC_SIGNALS contains only highly-specific markers: explicit comic
// format words, named comic publishers, and iconic character/series names.
// A title matching one of these is almost certainly a comic.

export const STRONG_COMIC_SIGNALS: readonly string[] = [
  // Unambiguous format words
  'comic', 'comics', 'graphic novel', 'manga',
  'tpb', 'trade paperback', 'compendium',
  // Comic publishers — high precision
  'marvel comics', 'dc comics', 'image comics',
  'dark horse comics', 'dark horse comic',
  'idw publishing', 'idw comics',
  'boom! studios', 'boom studios',
  'titan comics', 'oni press', 'fantagraphics',
  'aftershock comics', 'vault comics', 'valiant entertainment',
  // Manga publishers
  'viz media', 'viz comics', 'kodansha comics',
  'yen press', 'seven seas entertainment', 'tokyopop',
  'square enix manga',
  // Iconic character/series — highly specific to comics
  'batman', 'superman', 'spider-man', 'spiderman',
  'x-men', 'wonder woman', 'justice league',
  'the avengers', 'fantastic four', 'iron man',
  'deadpool', 'wolverine', 'captain america',
  'daredevil', 'teenage mutant ninja turtles', 'tmnt',
  'star wars: the', 'star wars adventures',
  'watchmen', 'sandman', 'invincible', 'walking dead',
  'sin city', 'preacher', 'hellboy', 'maus',
]

// Publisher-field exact matches (normalised lowercase). Used against the
// canonical_products.publisher column, not the title — high-precision.
export const COMIC_PUBLISHERS_EXACT: ReadonlySet<string> = new Set([
  'marvel', 'marvel comics', 'marvel worldwide',
  'dc', 'dc comics', 'dc black label',
  'image', 'image comics',
  'dark horse', 'dark horse comics', 'dark horse books',
  'idw', 'idw publishing',
  'boom!', 'boom! studios', 'boom studios',
  'titan comics', 'titan books',
  'oni press', 'oni-lion forge',
  'fantagraphics', 'fantagraphics books',
  'aftershock', 'aftershock comics',
  'vault comics', 'valiant entertainment', 'valiant',
  'viz', 'viz media', 'viz media llc',
  'kodansha', 'kodansha comics', 'kodansha usa',
  'yen press', 'yen on',
  'seven seas', 'seven seas entertainment',
  'tokyopop',
  'square enix', 'square enix manga',
  'shueisha', 'shogakukan',
  'drawn & quarterly', 'drawn and quarterly',
  'first second', 'first second books',
  'abrams', 'abrams comicarts',
  'top shelf', 'top shelf productions',
  'humanoids', 'humanoids inc',
])

/**
 * Strict comic check — true only when there's a high-confidence comic signal
 * in either the title (STRONG_COMIC_SIGNALS) or the publisher field
 * (COMIC_PUBLISHERS_EXACT). Used by the cleanup script's Bucket B+ to gate
 * which products are safe for bulk format reclassification.
 */
export function isStrongComic(title: string, publisher: string | null): boolean {
  if (publisher) {
    const p = publisher.toLowerCase().trim()
    if (COMIC_PUBLISHERS_EXACT.has(p)) return true
  }
  if (title) {
    const t = title.toLowerCase()
    for (const s of STRONG_COMIC_SIGNALS) {
      if (t.includes(s)) return true
    }
  }
  return false
}
