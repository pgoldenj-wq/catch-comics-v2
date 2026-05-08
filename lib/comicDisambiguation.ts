/**
 * comicDisambiguation — helpers to prevent non-comic marketplace products
 * from polluting results when a comic/manga title is also a common product term.
 *
 * Design principles:
 * - Opt-in: only titles in AMBIGUOUS_TITLES are affected.
 * - Additive: enrichment appends context; never removes CV results.
 * - High-precision rejection: only reject listings with unambiguous product words.
 * - Safe fallback: unknown titles → no changes whatsoever.
 */

// ── Normaliser ────────────────────────────────────────────────────────────────

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}

// ── Ambiguous title registry ──────────────────────────────────────────────────
// Titles that are also common product category names. Normalised (lowercase,
// no punctuation). Add new entries here; matching is exact after normalisation.

const AMBIGUOUS_TITLES = new Set([
  // ── Phase 1 originals ──────────────────────────────────────────────────
  'blade',
  'bleach',
  'cable',
  'die',
  'monster',
  'one piece',
  'sandman',
  'spawn',
  'venom',
  'watchmen',
  // generic word collisions (phase 1, no per-title rules yet)
  'angel',
  'arrow',
  'flash',
  'ghost',
  'power',
  'shield',
  'star',
  'witch',

  // ── Marvel / DC characters ─────────────────────────────────────────────
  'doom',        // Doctor Doom / Doom Patrol ↔ DOOM video game
  'hawkeye',     // Hawkeye ↔ Hawkeye optics brand
  'nova',        // Nova ↔ Chevy Nova, Nova brand
  'robin',       // Robin ↔ garden birds, Robin Hood costumes
  'rocket',      // Rocket Raccoon ↔ toy rockets, fireworks
  'storm',       // Storm (X-Men) ↔ Storm cleaning brand (UK)
  'thor',        // Thor ↔ Thor Tools brand, costumes
  'vision',      // Vision ↔ vision care / optician products
  'wolverine',   // Wolverine ↔ Wolverine workwear / boots brand

  // ── Manga titles ───────────────────────────────────────────────────────
  'chainsaw man', // Chainsaw Man ↔ actual chainsaws
  'claymore',     // Claymore ↔ claymore swords, Highland weaponry
  'pluto',        // Pluto (Urasawa) ↔ Disney Pluto, planet merchandise
  'switch',       // Switch ↔ Nintendo Switch, electrical switches

  // ── Indie / non-Big-Two titles ─────────────────────────────────────────
  'saga',        // Saga (Image) ↔ Saga Insurance / Holidays (UK)
  'sweet tooth', // Sweet Tooth (Image) ↔ candy, sweets, dental products
  'trees',       // Trees (Image) ↔ garden trees, landscaping products

  // ── Publisher / imprint names used as search terms ─────────────────────
  'titan',       // Titan Comics ↔ Titan Tools / paint brand (UK)
])

// ── Comic-context keywords ────────────────────────────────────────────────────
// If the query already contains any of these, enrichment is skipped — the
// user has already expressed comic intent.

const COMIC_CONTEXT_WORDS = [
  'comic', 'manga', 'graphic novel', 'omnibus', 'tpb', 'trade paperback',
  'issue', 'volume', 'vol', '#',
]

// ── Per-title product reject keywords ────────────────────────────────────────
// Words that, when found in a marketplace listing title, signal a non-comic
// product. Only high-confidence terms included — nothing that could appear
// in a legitimate comic listing.

const PER_TITLE_REJECT: Record<string, string[]> = {

  // ── Phase 1 originals ────────────────────────────────────────────────────

  blade: [
    'razor', 'shaving', 'shave', 'gillette', 'knife set', 'knife block',
    'blade pack', 'disposable blade', 'saw blade', 'utility blade', 'box cutter',
  ],
  bleach: [
    'cleaner', 'detergent', 'household', 'laundry', 'clorox', 'disinfectant',
    'cleaning spray', 'whitener', 'fabric softener',
  ],
  cable: [
    'hdmi', 'usb cable', 'ethernet', 'electrical cable', 'charging cable',
    'power cable', 'audio cable', 'rca cable', 'coaxial', 'extension lead',
    'copper wire', 'networking cable',
  ],
  die: [
    'cutting die', 'craft die', 'die cut', 'die set', 'scrapbook die',
    'sizzix', 'spellbinders', 'tabletop dice', 'dice set', 'd20', 'd6',
  ],
  monster: [
    'energy drink', 'energy can', 'beverage', 'energy beverage', 'monster can',
    'monster drink', 'gaming chair', 'energy shot',
  ],
  'one piece': [
    'swimwear', 'swimsuit', 'bathing suit', 'one-piece swimsuit', 'clothing lot',
    'swim wear', 'women swimsuit', 'girls swimsuit',
  ],
  sandman: [
    'sleep aid', 'sleep spray', 'sleep supplement', 'melatonin', 'sleep pillow',
    'sleeping aid', 'sleep drops',
  ],
  spawn: [
    'fish spawn', 'salmon spawn', 'fishing spawn', 'biology lab', 'server spawn',
    'game spawn', 'spawn rate',
  ],
  venom: [
    'snake venom', 'venom drink', 'energy can', 'tattoo ink',
    'poison extract', 'bee venom', 'spider venom',
  ],
  watchmen: [
    'wristwatch', 'wall clock', 'pocket watch', 'watch set', 'timepiece',
    'watch display', 'watch box', 'alarm clock', 'smart watch',
  ],

  // ── Phase 1 — fill-in: generic-word entries that previously had no rules ─

  angel: [
    'angel figurine', 'angel ornament', 'angel wings', 'angel costume',
    'christmas angel', 'angel decoration', 'guardian angel necklace',
  ],
  arrow: [
    'archery arrow', 'carbon arrow', 'compound bow', 'arrow shaft',
    'archery set', 'quiver', 'arrow fletching',
  ],
  flash: [
    'flash drive', 'usb flash', 'memory stick', 'camera flash unit',
    'flash wipes', 'flash spray', 'flash cleaner', 'flash kitchen',
  ],
  ghost: [
    'ghost costume', 'halloween ghost', 'ghost perfume', 'ghost fragrance',
    'ghost energy drink', 'ghost pepper sauce', 'ghost hunting equipment',
  ],
  power: [
    'power bank', 'power tool', 'power drill', 'power strip', 'powerbank',
    'extension socket', 'mains adaptor', 'power pack battery',
  ],
  shield: [
    'screen protector', 'face shield', 'welding shield', 'heat shield',
    'sun shield visor', 'protective shield',
  ],
  star: [
    'star sticker sheet', 'adhesive star', 'star shaped decoration',
    'gold star label', 'star rating sticker',
  ],
  witch: [
    'witch costume', 'witch hat', 'halloween witch', 'witch figurine',
    'witch decoration', 'witch broomstick',
  ],

  // ── Marvel / DC characters ───────────────────────────────────────────────

  doom: [
    'doom game', 'doom eternal', 'doom ps4', 'doom xbox', 'doom pc game',
    'doom slayer', 'doom nintendo', 'fps game doom',
  ],
  hawkeye: [
    'binoculars', 'rifle scope', 'spotting scope', 'hawkeye scope',
    'tactical optics', 'laser rangefinder', 'night vision scope',
  ],
  nova: [
    'chevy nova', 'nova car', 'nova hair dye', 'nova lox',
    'nova cheese', 'nova headphones brand',
  ],
  robin: [
    'bird feeder', 'garden bird', 'robin ornament', 'robin redbreast',
    'robin hood costume', 'robin hood fancy dress', 'bird decoration',
  ],
  rocket: [
    'toy rocket', 'model rocket', 'estes rocket', 'water rocket',
    'foam rocket', 'rocket firework', 'sky rocket', 'aerial firework',
  ],
  storm: [
    'storm cleaner', 'storm wipes', 'storm kitchen spray',
    'waterproof jacket storm', 'stormproof jacket', 'storm mac',
  ],
  thor: [
    'thor tools', 'claw hammer', 'demolition hammer', 'mjolnir toy',
    'thor costume', 'thor fancy dress', 'thor helmet replica',
  ],
  vision: [
    'contact lens', 'reading glasses', 'spectacles', 'eye drops',
    'varifocal', 'vision test kit', 'eye care kit', 'optician voucher',
  ],
  wolverine: [
    'wolverine boot', 'wolverine work boot', 'wolverine footwear',
    'wolverine safety boot', 'wolverine glove', 'wolverine workwear',
  ],

  // ── Manga titles ─────────────────────────────────────────────────────────

  'chainsaw man': [
    'petrol chainsaw', 'electric chainsaw', 'chainsaw bar', 'chainsaw oil',
    'chainsaw chain', 'stihl chainsaw', 'husqvarna chainsaw',
  ],
  claymore: [
    'claymore sword', 'medieval sword', 'highland sword', 'scottish claymore',
    'claymore mine', 'movie prop sword', 'wall sword display',
  ],
  pluto: [
    'disney pluto', 'pluto stuffed toy', 'pluto dog toy', 'pluto tv',
    'pluto planet', 'astronomy pluto', 'pluto ornament',
  ],
  switch: [
    'nintendo switch', 'light switch', 'wall switch', 'toggle switch',
    'network switch', 'ethernet switch', 'switch plate', 'power switch console',
  ],

  // ── Indie titles ─────────────────────────────────────────────────────────

  saga: [
    'saga insurance', 'saga holidays', 'saga cruise', 'saga magazine subscription',
    'saga travel', 'over 50s insurance',
  ],
  'sweet tooth': [
    'sweet shop', 'candy gift box', 'chocolate hamper', 'sweet hamper',
    'candy bar set', 'pick n mix', 'sweet treat box',
  ],
  trees: [
    'tree sapling', 'garden tree', 'bonsai tree', 'christmas tree',
    'tree seed', 'tree stake', 'tree guard', 'tree fertiliser', 'tree fertilizer',
  ],

  // ── Publisher / imprint ───────────────────────────────────────────────────

  titan: [
    'titan tools', 'titan paint roller', 'titan spray gun', 'titan brush set',
    'titan tool set', 'titan decorating',
  ],
}

// ── Generic non-comic terms ───────────────────────────────────────────────────
// Product signals that are never legitimate in a comic listing, regardless of
// which title is being searched. Checked against ALL listings.

const GENERIC_NON_COMIC_TERMS = [
  'energy drink', 'energy can', 'razor blades', 'hdmi cable', 'usb cable',
  'ethernet cable', 'charging cable', 'swimwear', 'swimsuit', 'bathing suit',
  'household cleaner', 'cleaning spray', 'laundry detergent', 'sleep supplement',
  'melatonin gummies', 'vitamin gummies', 'dietary supplement', 'protein powder',
  'power tool', 'drill bit set', 'saw blade set', 'cutting mat',
  'nintendo switch console', 'work boot set', 'safety footwear',
]

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns true when the query (or comic name) is a known ambiguous title that
 * is also a common product category. Unknown titles always return false.
 */
export function isAmbiguousComicTitle(query: string): boolean {
  return AMBIGUOUS_TITLES.has(norm(query))
}

/**
 * Appends " comic" to the query when:
 *   1. The title is in the ambiguous registry, AND
 *   2. The query does not already contain comic-context language.
 *
 * This improves eBay search precision within the Comics category without
 * double-qualifying queries that are already specific ("Bleach manga vol 5").
 */
export function enrichEbayQuery(comicName: string): string {
  if (!isAmbiguousComicTitle(comicName)) return comicName
  const lower = comicName.toLowerCase()
  const alreadyContextual = COMIC_CONTEXT_WORDS.some(w => lower.includes(w))
  if (alreadyContextual) return comicName
  return `${comicName} comic`
}

/**
 * Returns true when a marketplace listing title almost certainly represents a
 * non-comic product. Checks generic product terms first, then per-title terms
 * when a comic name is supplied.
 *
 * Safe fallback: returns false when unsure, so legitimate listings are never
 * wrongly suppressed.
 */
export function isNonComicListing(listingTitle: string, comicName?: string): boolean {
  const t = listingTitle.toLowerCase()

  for (const term of GENERIC_NON_COMIC_TERMS) {
    if (t.includes(term)) return true
  }

  if (comicName && isAmbiguousComicTitle(comicName)) {
    const perTitle = PER_TITLE_REJECT[norm(comicName)] ?? []
    for (const term of perTitle) {
      if (t.includes(term)) return true
    }
  }

  return false
}
