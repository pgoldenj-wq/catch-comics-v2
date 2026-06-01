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
    formatLabel:  string
    lowestPrice:  number | null
    currency:     string
    inStock:      boolean
  }>
}

export interface SeriesPageData {
  displayName:  string
  publisher:    string | null
  description:  string | null
  heroCoverUrl: string | null
  volumes:      VolumeCardData[]
  editionGroups: EditionGroup[]
}

export const FORMAT_LABELS: Record<string, string> = {
  SINGLE_ISSUE: 'Single Issue',
  TPB:          'Trade Paperback',
  HARDCOVER:    'Hardcover',
  OMNIBUS:      'Omnibus',
  DELUXE:       'Deluxe Edition',
  COMPENDIUM:   'Compendium',
  MANGA_VOLUME: 'Manga Volume',
  ABSOLUTE:     'Absolute Edition',
  OTHER:        'Comic',
}

export const FORMAT_DESCRIPTORS: Record<string, string> = {
  TPB:          'Standard softcover collected edition',
  HARDCOVER:    'Premium hardcover with sewn binding',
  OMNIBUS:      'Large-format omnibus collecting multiple arcs',
  ABSOLUTE:     'Oversized slipcased collector edition',
  DELUXE:       'Deluxe hardcover with bonus content',
  COMPENDIUM:   'Compendium collecting a complete run',
  MANGA_VOLUME: 'Standard manga volume',
}
