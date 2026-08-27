/**
 * lib/identity/isbn.ts — the ONE canonical ISBN validator for Catch Comics.
 *
 * Before this module there were two half-validators and they disagreed:
 *
 *   lib/identity/edition.ts   checked the checksum but NOT the 978/979 book
 *                             prefix, so any checksum-valid EAN-13 (a grocery
 *                             barcode, a UPC-A widened to 13) read as an ISBN.
 *   shared/matching.ts        checked the 978/979 prefix but NOT the checksum,
 *                             so a corrupt retailer barcode became trusted
 *                             identity. Every adapter used this one, and it is
 *                             how four canonical products acquired ISBNs that
 *                             identify no edition that has ever existed
 *                             (audit 2026-08-26, scripts/audit-isbn-truth.ts).
 *
 * A trusted ISBN-13 must satisfy ALL THREE of shape, Bookland prefix and
 * checksum. Anything less is not identity, and identity is what the whole
 * retailer-matching story rests on: `matchCanonical` grants confidence 95 on
 * an ISBN hit, so a bad ISBN is not a cosmetic blemish — it is a wrong product.
 *
 * Rules encoded here:
 *   - wrong ISBN is worse than missing ISBN → validation never "repairs"
 *   - ISBN stays a STRING, always (leading zeroes, and 9780306406157 exceeds
 *     Number.MAX_SAFE_INTEGER's precision for exact digit round-trips)
 *   - ISBN-10 → ISBN-13 is deterministic arithmetic, NOT evidence that two
 *     records are the same edition
 *   - 979 has no ISBN-10 form; we never invent one
 *
 * Pure functions, no I/O. Tests: tests/isbn.test.ts (npm run test:isbn).
 */

/** Presentation characters that may be safely stripped: hyphens and spaces only. */
const SEPARATORS = /[-\s]/g

/** The only ISBN Bookland prefixes. 978 = books, 979 = books (incl. 979-8 self-pub). */
const BOOK_PREFIXES = ['978', '979'] as const

/** Strip hyphens/spaces. Never strips anything else — junk must stay junk. */
function strip(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.replace(SEPARATORS, '')
  return s.length > 0 ? s : null
}

/** Weighted mod-10 check digit for the first 12 digits of an ISBN-13/EAN-13. */
function ean13CheckDigit(first12: string): number {
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3)
  return (10 - (sum % 10)) % 10
}

/** True when a 13-digit string carries a correct EAN-13/ISBN-13 check digit. */
export function hasValidEan13Checksum(digits: string): boolean {
  if (!/^\d{13}$/.test(digits)) return false
  return ean13CheckDigit(digits.slice(0, 12)) === Number(digits[12])
}

/** True when a 10-character string is a checksum-valid ISBN-10 (X = 10). */
export function hasValidIsbn10Checksum(value: string): boolean {
  if (!/^\d{9}[\dX]$/.test(value.toUpperCase())) return false
  const s = value.toUpperCase()
  let sum = 0
  for (let i = 0; i < 10; i++) {
    sum += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i)
  }
  return sum % 11 === 0
}

/** True when a 13-digit string starts with a Bookland prefix. */
export function hasBookPrefix(digits: string): boolean {
  return BOOK_PREFIXES.some(p => digits.startsWith(p))
}

/**
 * Normalise to a TRUSTED ISBN-13, or null.
 *
 * Trusted means all three of: exactly 13 digits, 978/979 prefix, valid
 * checksum. A checksum-valid 13-digit barcode that is not book-prefixed is a
 * perfectly good EAN — it is simply not an ISBN, and returning null here is
 * the point rather than a limitation. Use `classifyBarcode` when you want to
 * keep the EAN.
 */
export function normalizeIsbn13(raw: string | null | undefined): string | null {
  const s = strip(raw)
  if (!s || !/^\d{13}$/.test(s)) return null
  if (!hasBookPrefix(s)) return null
  return hasValidEan13Checksum(s) ? s : null
}

/**
 * Convert a checksum-valid ISBN-10 into its ISBN-13 form; null if invalid.
 *
 * Deterministic: 978 + first 9 digits + recomputed check digit. This is a
 * representation change of ONE identifier, never evidence that two records
 * describe the same edition.
 */
export function isbn10To13(raw: string | null | undefined): string | null {
  const s = strip(raw)?.toUpperCase()
  if (!s || !hasValidIsbn10Checksum(s)) return null
  const core = '978' + s.slice(0, 9)
  return core + String(ean13CheckDigit(core))
}

/**
 * Convert an ISBN-13 back to its ISBN-10 form; null when not representable.
 *
 * Only 978-prefixed ISBNs have an ISBN-10 equivalent. 979 never does, and
 * fabricating one would mint an identifier that addresses a different book.
 */
export function isbn13To10(raw: string | null | undefined): string | null {
  const s = normalizeIsbn13(raw)
  if (!s || !s.startsWith('978')) return null
  const core = s.slice(3, 12)
  let sum = 0
  for (let i = 0; i < 9; i++) sum += Number(core[i]) * (10 - i)
  const check = (11 - (sum % 11)) % 11
  return core + (check === 10 ? 'X' : String(check))
}

/** Best-effort TRUSTED ISBN-13 from either an ISBN-13 or an ISBN-10 input. */
export function normalizeAnyIsbn(raw: string | null | undefined): string | null {
  return normalizeIsbn13(raw) ?? isbn10To13(raw)
}

/** Convenience predicate — is this a trusted ISBN-13 exactly as stored? */
export function isValidIsbn13(raw: string | null | undefined): boolean {
  return normalizeIsbn13(raw) !== null
}

/**
 * Classify a retailer barcode / SKU into the identifier it actually is.
 *
 * This replaces the prefix-only guess adapters used to make. The ordering
 * matters: a value is only ever an ISBN when it survives full validation, so
 * a mistyped 978… barcode falls through to `{ isbn13: null, ean: null }`
 * rather than being promoted to product identity.
 *
 *   valid ISBN-13 (978/979 + checksum)   → { isbn13, ean: null }
 *   valid ISBN-10 (checksum)             → { isbn13: <converted>, ean: null }
 *   other checksum-valid 13-digit EAN    → { isbn13: null, ean }
 *   anything else                        → { isbn13: null, ean: null }
 */
export function classifyBarcode(raw: string | null | undefined): {
  isbn13: string | null
  ean:    string | null
} {
  const s = strip(raw)
  if (!s) return { isbn13: null, ean: null }

  // ISBN-13 / ISBN-10 straight from the value.
  const direct = normalizeAnyIsbn(s)
  if (direct) return { isbn13: direct, ean: null }

  // Digits-only fallback: some feeds wrap the barcode in punctuation or
  // letters (e.g. "EAN:9781506747613"). Digits are extracted, but the result
  // still has to pass full validation before it can be called an ISBN.
  const digits = s.replace(/\D/g, '')

  if (digits.length === 13) {
    if (!hasValidEan13Checksum(digits)) return { isbn13: null, ean: null }
    return hasBookPrefix(digits)
      ? { isbn13: digits, ean: null }
      : { isbn13: null, ean: digits }
  }

  // UPC-A is a 12-digit EAN-13 with an implicit leading zero. Never an ISBN.
  if (digits.length === 12) {
    const widened = '0' + digits
    if (hasValidEan13Checksum(widened)) return { isbn13: null, ean: widened }
  }

  return { isbn13: null, ean: null }
}
