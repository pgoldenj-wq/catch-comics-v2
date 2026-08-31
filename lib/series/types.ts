export interface SeriesEntry {
  displayName: string
  cvVolumeId:  string
  publisher:   string
}

export interface VolumeCardData {
  slug:         string
  title:        string
  volumeNumber: number | null
  format:       string
  coverUrl:     string | null
  lowestPrice:  number | null
  currency:     string
  inStock:      boolean
  isStartHere:  boolean
  isbn13:       string | null
}

export interface EditionGroup {
  volumeNumber: number | null
  editions: Array<{
    slug:         string
    format:       string
    /** null when the format is unknown — the card must not name one. */
    formatLabel:  string | null
    lowestPrice:  number | null
    currency:     string
    inStock:      boolean
  }>
}

export interface SeriesPageData {
  displayName:  string
  publisher:    string | null
  description:  string | null
  /** True when description came from a ComicVine synopsis — UI attributes it. */
  descriptionIsCv: boolean
  heroCoverUrl: string | null
  volumes:      VolumeCardData[]
  editionGroups: EditionGroup[]
}

// Format labels live in lib/identity/format — one map for the whole site, so a
// format can never read one way in search and another way on a series page.
export { FORMAT_LABELS, formatLabel } from '@/lib/identity/format'

export const FORMAT_DESCRIPTORS: Record<string, string> = {
  TPB:          'Standard softcover collected edition',
  HARDCOVER:    'Premium hardcover with sewn binding',
  OMNIBUS:      'Large-format omnibus collecting multiple arcs',
  ABSOLUTE:     'Oversized slipcased collector edition',
  DELUXE:       'Deluxe hardcover with bonus content',
  COMPENDIUM:   'Compendium collecting a complete run',
  MANGA_VOLUME: 'Standard manga volume',
}
