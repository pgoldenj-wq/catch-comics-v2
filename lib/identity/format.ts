/**
 * lib/identity/format.ts — the single source of truth for how a product's
 * edition format is named in the UI.
 *
 * Founder review search-2026-08-29-14-02-u3pppa: every surface used to carry
 * its own label map, and the search page carried a *lossy* one that collapsed
 * ABSOLUTE / DELUXE / HARDCOVER into one "Hardcover Edition" label (and
 * OMNIBUS / COMPENDIUM into "Omnibus / Deluxe"). An Absolute Edition therefore
 * read as a Hardcover across search. Results with no DB format at all were
 * worse: the label was *guessed* from the title, so anything containing the
 * word "absolute" became "Hardcover Edition".
 *
 * The rules, applied everywhere:
 *   - One ProductFormat enum value ⇒ one distinct label. Never collapsed.
 *   - An unknown format (OTHER, or a record with no format at all) has NO
 *     label. It is omitted, never defaulted and never inferred from the title.
 *
 * Pure data + pure functions — safe in server components, client components
 * and scripts alike.
 */

/** ProductFormat enum value → the label shown to users. */
export const FORMAT_LABELS: Record<string, string> = {
  SINGLE_ISSUE: 'Single Issue',
  TPB:          'Trade Paperback',
  HARDCOVER:    'Hardcover',
  OMNIBUS:      'Omnibus',
  DELUXE:       'Deluxe Edition',
  COMPENDIUM:   'Compendium',
  MANGA_VOLUME: 'Manga Volume',
  ABSOLUTE:     'Absolute Edition',
  // OTHER is deliberately absent — see formatLabel().
}

/**
 * Label for a stored format, or null when the format is unknown.
 *
 * null means "we do not know this edition's format", which covers OTHER, a
 * missing value, and any enum member added to the schema before this map.
 * Callers must omit the label in that case rather than substituting a
 * plausible-looking one.
 */
export function formatLabel(format?: string | null): string | null {
  if (!format) return null
  return FORMAT_LABELS[format] ?? null
}
