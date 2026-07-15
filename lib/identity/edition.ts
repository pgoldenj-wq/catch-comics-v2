/**
 * lib/identity/edition.ts — product/edition identity helpers (Wave 4 Phase 4).
 *
 * The single source of truth for "are these two records the same physical
 * edition?". Built for the trust rules in the product-excellence programme:
 *
 *   - Never merge on fuzzy title similarity alone.
 *   - Same title + different ISBN → DIFFERENT editions. Always.
 *   - Hardcover vs paperback, omnibus vs standard, box set vs volume,
 *     digital vs physical, Vol 1 vs Issue 1 → never merged.
 *   - Only the verdict 'match' may ever group offers; 'uncertain' is a
 *     display-layer hint at most, and 'reject' is final.
 *
 * Pure functions, no I/O — safe to use in scripts, API routes and tests.
 * Negative tests: scripts/test-edition-identity.ts (npm run test:identity).
 */

// ── ISBN normalisation ────────────────────────────────────────────────────────

/** Strip separators; return a checksum-valid ISBN-13 or null. */
export function normalizeIsbn13(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.replace(/[-\s]/g, '')
  if (!/^\d{13}$/.test(s)) return null
  const sum = [...s].slice(0, 12).reduce((acc, ch, i) => acc + Number(ch) * (i % 2 === 0 ? 1 : 3), 0)
  const check = (10 - (sum % 10)) % 10
  return check === Number(s[12]) ? s : null
}

/** Convert a checksum-valid ISBN-10 to ISBN-13 (978 prefix); null if invalid. */
export function isbn10To13(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.replace(/[-\s]/g, '').toUpperCase()
  if (!/^\d{9}[\dX]$/.test(s)) return null
  const sum = [...s].reduce((acc, ch, i) => acc + (ch === 'X' ? 10 : Number(ch)) * (10 - i), 0)
  if (sum % 11 !== 0) return null
  const core = '978' + s.slice(0, 9)
  const csum = [...core].reduce((acc, ch, i) => acc + Number(ch) * (i % 2 === 0 ? 1 : 3), 0)
  return core + String((10 - (csum % 10)) % 10)
}

/** Best-effort ISBN-13 from any ISBN-shaped input. */
export function normalizeAnyIsbn(raw: string | null | undefined): string | null {
  return normalizeIsbn13(raw) ?? isbn10To13(raw)
}

// ── Edition signals from titles ───────────────────────────────────────────────

export interface EditionSignals {
  boxSet: boolean
  digital: boolean
  omnibus: boolean
  hardcoverFamily: boolean   // HC / deluxe / absolute — never merges with softcover
  singleIssue: boolean
  volumeNumber: number | null
  issueNumber: number | null
}

export function detectEditionSignals(title: string): EditionSignals {
  const t = ` ${title.toLowerCase()} `
  const volMatch   = t.match(/\b(?:vol(?:ume)?\.?\s*|book\s+)(\d+)\b/)
  // Issue: "#5" style — but not "Vol. #1" / "Book #2" collection numbering.
  const issueMatch = t.match(/(?<![a-z])(?<!vol\.?\s)(?<!book\s)#\s?(\d+)\b/) ?? t.match(/\bissue\s+(\d+)\b/)
  return {
    boxSet:  /\b(box\s*set|boxed\s*set|slipcase|complete\s+collection\s+\d+\s*-\s*\d+)\b/.test(t),
    digital: /\b(kindle|e-?book|digital\s+edition|comixology)\b/.test(t),
    omnibus: /\b(omnibus|compendium)\b/.test(t),
    hardcoverFamily: /\b(hardcover|hardback|\bhc\b|deluxe|absolute\s+edition)\b/.test(t),
    singleIssue: issueMatch !== null,
    volumeNumber: volMatch ? parseInt(volMatch[1], 10) : null,
    issueNumber:  issueMatch ? parseInt(issueMatch[1], 10) : null,
  }
}

// ── Edition match verdict ─────────────────────────────────────────────────────

export interface EditionRecord {
  isbn13?: string | null
  isbn10?: string | null
  title: string
  /** ProductFormat enum string where known (SINGLE_ISSUE, TPB, …) */
  format?: string | null
  volumeNumber?: number | null
  issueNumber?: string | number | null
  publisher?: string | null
}

export interface MatchVerdict {
  verdict: 'match' | 'uncertain' | 'reject'
  confidence: number
  reason: string
}

const HC_FAMILY = new Set(['HARDCOVER', 'DELUXE', 'ABSOLUTE'])
const BIG_FORMATS = new Set(['OMNIBUS', 'COMPENDIUM'])
const SOFT_FAMILY = new Set(['TPB', 'MANGA_VOLUME'])

function formatsIncompatible(a?: string | null, b?: string | null): boolean {
  if (!a || !b || a === 'OTHER' || b === 'OTHER' || a === b) return false
  if (a === 'SINGLE_ISSUE' || b === 'SINGLE_ISSUE') return true
  if (BIG_FORMATS.has(a) !== BIG_FORMATS.has(b)) return true
  if (HC_FAMILY.has(a) !== HC_FAMILY.has(b)) return true
  if (SOFT_FAMILY.has(a) && SOFT_FAMILY.has(b) && a !== b) return false // TPB vs MANGA_VOLUME: cataloguing variance, not edition difference
  return false
}

const normTitle = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Decide whether two records describe the same physical edition.
 * Identity evidence order: ISBN beats everything; structured agreement
 * without ISBN can only ever reach 'uncertain'; bare titles are rejected.
 */
export function editionMatchVerdict(a: EditionRecord, b: EditionRecord): MatchVerdict {
  const isbnA = normalizeAnyIsbn(a.isbn13) ?? normalizeAnyIsbn(a.isbn10)
  const isbnB = normalizeAnyIsbn(b.isbn13) ?? normalizeAnyIsbn(b.isbn10)

  // 1. ISBN is decisive in both directions.
  if (isbnA && isbnB) {
    return isbnA === isbnB
      ? { verdict: 'match', confidence: 1, reason: 'isbn13-exact' }
      : { verdict: 'reject', confidence: 1, reason: 'isbn-mismatch: same-looking titles with different ISBNs are different editions' }
  }

  const sigA = detectEditionSignals(a.title)
  const sigB = detectEditionSignals(b.title)

  // 2. Category walls — never crossed without an equal ISBN.
  if (sigA.boxSet !== sigB.boxSet)
    return { verdict: 'reject', confidence: 1, reason: 'box-set-vs-individual' }
  if (sigA.digital !== sigB.digital)
    return { verdict: 'reject', confidence: 1, reason: 'digital-vs-physical' }
  if (formatsIncompatible(a.format, b.format))
    return { verdict: 'reject', confidence: 1, reason: `format-incompatible: ${a.format} vs ${b.format}` }
  if (!a.format || !b.format) {
    // Fall back to title signals when explicit formats are missing.
    if (sigA.omnibus !== sigB.omnibus)
      return { verdict: 'reject', confidence: 1, reason: 'omnibus-vs-standard (title signal)' }
    if (sigA.hardcoverFamily !== sigB.hardcoverFamily)
      return { verdict: 'reject', confidence: 0.9, reason: 'hardcover-vs-softcover (title signal)' }
  }

  // 3. Volume/issue walls. Vol 1 and Issue 1 are never the same object.
  const volA = a.volumeNumber ?? sigA.volumeNumber
  const volB = b.volumeNumber ?? sigB.volumeNumber
  const issA = a.issueNumber != null ? Number(a.issueNumber) : sigA.issueNumber
  const issB = b.issueNumber != null ? Number(b.issueNumber) : sigB.issueNumber
  if (volA != null && volB != null && volA !== volB)
    return { verdict: 'reject', confidence: 1, reason: `volume-mismatch: ${volA} vs ${volB}` }
  if ((volA != null && issB != null && volB == null) || (volB != null && issA != null && volA == null))
    return { verdict: 'reject', confidence: 1, reason: 'volume-vs-issue: Vol N and Issue N are different objects' }

  // 4. No ISBN on either side: structured agreement caps at 'uncertain'.
  const titlesAgree = normTitle(a.title) === normTitle(b.title)
  if (!titlesAgree)
    return { verdict: 'reject', confidence: 0.8, reason: 'title-disagreement without ISBN evidence' }

  const pubAgree = !a.publisher || !b.publisher
    || normTitle(a.publisher) === normTitle(b.publisher)
  const structured = titlesAgree && volA === volB && (a.format ?? null) === (b.format ?? null) && pubAgree
  if (structured)
    return { verdict: 'uncertain', confidence: 0.7, reason: 'structured-agreement-without-isbn: presentation hint only, never auto-merged' }

  return { verdict: 'reject', confidence: 0.9, reason: 'title-only-insufficient: fuzzy title similarity never merges editions' }
}
