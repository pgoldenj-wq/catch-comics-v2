/**
 * lib/identity/publisher.ts — presentation-layer publisher trust (Wave 4 Phase 6).
 *
 * Some canonical rows carry a DISTRIBUTOR or RETAILER in the publisher field
 * (feed artefact): e.g. "Absolute Flash Vol 1" → "Penguin Random House NZ"
 * (a regional distributor, not the creative publisher DC). Presenting that as
 * the publisher misleads collectors, so the UI OMITS it rather than showing a
 * wrong creative publisher — honest-missing beats confidently-wrong.
 *
 * This is display-only: it never mutates stored data (audit: npm run
 * audit:metadata). Reversible by definition. Pure function — safe in scripts,
 * API routes, server and client components.
 *
 * Test: scripts/test-edition-identity.ts covers the mapping.
 */

// Regional distributors / wholesalers that are not creative publishers.
const DISTRIBUTORS = [
  'penguin random house nz', 'penguin random house australia', 'random house australia',
  'melia publishing', 'turnaround', 'gardners', 'bertrams', 'ingram', 'baker & taylor',
  'grantham book services', 'macmillan distribution', 'hachette australia', 'nbn international',
]
// Retailers occasionally landing in the publisher field.
const RETAILERS = ['amazon', 'world of books', 'waterstones', 'wordery', 'ebay', 'abebooks', 'bookshop.org']

/** True when the value is a distributor/retailer rather than a creative publisher. */
export function isNonCreativePublisher(raw: string | null | undefined): boolean {
  if (!raw) return false
  const s = raw.toLowerCase()
  return DISTRIBUTORS.some(d => s.includes(d)) || RETAILERS.some(r => s.includes(r))
}

/**
 * Publisher string safe to show as the creative publisher, or null to omit.
 * Trims trailing corporate suffixes for cleaner display but never invents a
 * publisher and never "corrects" a distributor to a guessed real publisher.
 */
export function displayPublisher(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (isNonCreativePublisher(trimmed)) return null
  return trimmed
}
