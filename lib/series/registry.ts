import type { SeriesEntry } from './types'

/**
 * Canonical series registry for Series Pages MVP.
 *
 * Keyed by URL slug. cvVolumeId values verified against the live database
 * (audit run 2026-06-01). Each ID is the ComicVine volume ID shared by all
 * collected-edition products in that series.
 *
 * To add a new series:
 *  1. Confirm the CV volume ID is consistent across the product rows.
 *  2. Add an entry here.
 *  3. Run `npm run check` to confirm TypeScript is clean.
 *  4. The page is auto-registered via generateStaticParams.
 */
export const SERIES_REGISTRY: Record<string, SeriesEntry> = {
  'saga': {
    displayName: 'Saga',
    cvVolumeId:  '46568',
    publisher:   'Image Comics',
  },
  'the-walking-dead': {
    displayName: 'The Walking Dead',
    cvVolumeId:  '18166',
    publisher:   'Image Comics',
  },
  'fullmetal-alchemist': {
    displayName: 'Fullmetal Alchemist',
    cvVolumeId:  '20515',
    publisher:   'Viz Media',
  },
  'invincible': {
    displayName: 'Invincible',
    cvVolumeId:  '17993',
    publisher:   'Image Comics',
  },
  'claymore': {
    displayName: 'Claymore',
    cvVolumeId:  '21739',
    publisher:   'Viz Media',
  },
  'overlord': {
    displayName: 'Overlord',
    cvVolumeId:  '91727',
    publisher:   'Yen Press',
  },
  'trigun-maximum-deluxe': {
    displayName: 'Trigun Maximum Deluxe Edition',
    cvVolumeId:  '29569',
    publisher:   'Dark Horse Comics',
  },
}

/** Returns the SeriesEntry for a slug, or null if not registered. */
export function getSeriesEntry(slug: string): SeriesEntry | null {
  return SERIES_REGISTRY[slug] ?? null
}

/** All registered slugs — used by generateStaticParams. */
export function getAllSeriesSlugs(): string[] {
  return Object.keys(SERIES_REGISTRY)
}

/**
 * Converts a series name to its URL slug form.
 * Idempotent: seriesNameToSlug(seriesNameToSlug(x)) === seriesNameToSlug(x)
 *
 * Examples:
 *   "The Walking Dead"  → "the-walking-dead"
 *   "The walking dead"  → "the-walking-dead"   (case-insensitive)
 *   "Fullmetal Alchemist" → "fullmetal-alchemist"
 *   "YuYu Hakusho"      → "yuyu-hakusho"
 */
export function seriesNameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
