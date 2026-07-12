import { prisma }        from '@/lib/prisma'
import { isBadCoverUrl } from '@/lib/images/url-filters'
import { stripHtml }     from '@/lib/utils/text'
import { FORMAT_LABELS } from './types'
import type { SeriesEntry, SeriesPageData, VolumeCardData, EditionGroup } from './types'
import { ProductFormat } from '@prisma/client'

interface CvMetaShape {
  synopsis?: string | null
  [key: string]: unknown
}

/**
 * W2-2: presentation cleanup for series descriptions. CV synopses are wiki
 * articles — pull quotes, "Awards"/"Hiatus" sections, non-English edition
 * lists — which read as a raw dump on a retail page. Take only the first
 * paragraph (block-level HTML breaks preserved before stripping), capped at a
 * sentence boundary. Source data is never modified.
 */
function firstParagraph(html: string, maxLen = 480): string {
  const withBreaks = html
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
  const first = withBreaks
    .split('\n')
    .map(chunk => stripHtml(chunk))
    .find(chunk => chunk.length > 50) ?? stripHtml(withBreaks)
  if (first.length <= maxLen) return first
  // Cut at the last sentence end before the cap; fall back to a hard cap.
  const cut = first.slice(0, maxLen)
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.” '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  return lastStop > 120 ? cut.slice(0, lastStop + 1) : `${cut.trimEnd()}…`
}

const IN_STOCK = new Set(['IN_STOCK', 'LOW_STOCK', 'PREORDER'])

/**
 * Fetches and transforms all collected-edition volumes for a series,
 * grouped by the series' ComicVine volume ID.
 *
 * Sorted: volumeNumber ASC NULLS LAST → releaseDate ASC NULLS LAST → title ASC
 * Price:  cheapest in-stock or pre-order listing per product (LEFT JOIN).
 */
export async function getSeriesData(entry: SeriesEntry): Promise<SeriesPageData> {
  const products = await prisma.canonicalProduct.findMany({
    where: {
      comicvineId: entry.cvVolumeId,
      format:      { not: ProductFormat.SINGLE_ISSUE },
      deletedAt:   null,
    },
    include: {
      listings: {
        where: {
          deletedAt:   null,
          priceAmount: { gt: 0 },
          retailer:    { isActive: true },
        },
        select: {
          priceAmount:   true,
          priceCurrency: true,
          stockStatus:   true,
        },
        orderBy: { priceAmount: 'asc' },
      },
    },
  })

  // ── Sort ─────────────────────────────────────────────────────────────────
  products.sort((a, b) => {
    const vnA = a.volumeNumber ?? Infinity
    const vnB = b.volumeNumber ?? Infinity
    if (vnA !== vnB) return vnA - vnB

    const rdA = a.releaseDate?.getTime() ?? Infinity
    const rdB = b.releaseDate?.getTime() ?? Infinity
    if (rdA !== rdB) return rdA - rdB

    return a.title.localeCompare(b.title)
  })

  // ── Description: first meaningful CV synopsis across sorted products.
  //    W2-2: first paragraph only (see firstParagraph) — never the raw wiki
  //    dump — and the ComicVine origin is flagged so the UI can attribute it.
  let description: string | null = null
  let descriptionIsCv = false
  for (const p of products) {
    const cvMeta   = (p as { cvMetadata?: CvMetaShape | null }).cvMetadata ?? null
    const cvText   = cvMeta?.synopsis ? firstParagraph(cvMeta.synopsis) : ''
    const dbText   = p.description     ? firstParagraph(p.description)  : ''
    const useCv    = cvText.length > dbText.length + 40
    const candidate = useCv ? cvText : dbText
    if (candidate.length > 50) {
      description     = candidate
      // Attribute ComicVine whenever the shown text matches the CV synopsis —
      // enrichment sometimes copies CV text into the description column, so
      // source-column alone under-attributes (observed on Saga).
      descriptionIsCv = useCv
        || (cvText.length > 50 && candidate.slice(0, 80) === cvText.slice(0, 80))
      break
    }
  }

  // ── Hero cover: prefer a real (R2) cover, then fall back to the first
  //    non-placeholder cover. Open Library fallback URLs frequently 404, so a
  //    broken OL Vol-1 cover should not win over a later volume's R2 cover. ────
  let heroCoverUrl: string | null = null
  for (const p of products) {
    if (p.coverImageUrl?.startsWith('https://images.catchcomics.com')) {
      heroCoverUrl = p.coverImageUrl
      break
    }
  }
  if (!heroCoverUrl) {
    for (const p of products) {
      if (p.coverImageUrl && !isBadCoverUrl(p.coverImageUrl)) {
        heroCoverUrl = p.coverImageUrl
        break
      }
    }
  }

  // ── Volume cards ──────────────────────────────────────────────────────────
  const volumes: VolumeCardData[] = products.map((p, i) => {
    const cheapest = p.listings.find(l => IN_STOCK.has(l.stockStatus as string))
    return {
      slug:         p.canonicalSlug,
      title:        p.title,
      volumeNumber: p.volumeNumber,
      format:       p.format as string,
      coverUrl:     p.coverImageUrl && !isBadCoverUrl(p.coverImageUrl)
                      ? p.coverImageUrl
                      : null,
      lowestPrice:  cheapest ? Number(cheapest.priceAmount) : null,
      currency:     cheapest?.priceCurrency ?? 'GBP',
      inStock:      cheapest !== null,
      isStartHere:  i === 0,
      isbn13:       p.isbn13 ?? null,
    }
  })

  // ── Edition groups: same volumeNumber, 2+ formats ─────────────────────────
  const byVolNum = new Map<string, VolumeCardData[]>()
  for (const v of volumes) {
    const key   = v.volumeNumber !== null ? String(v.volumeNumber) : '__null__'
    const group = byVolNum.get(key) ?? []
    group.push(v)
    byVolNum.set(key, group)
  }

  const editionGroups: EditionGroup[] = []
  for (const group of byVolNum.values()) {
    const uniqueFormats = new Set(group.map(v => v.format))
    if (uniqueFormats.size >= 2) {
      editionGroups.push({
        volumeNumber: group[0].volumeNumber,
        editions: group.map(v => ({
          slug:        v.slug,
          format:      v.format,
          formatLabel: FORMAT_LABELS[v.format] ?? v.format,
          lowestPrice: v.lowestPrice,
          currency:    v.currency,
          inStock:     v.inStock,
        })),
      })
    }
  }

  return {
    displayName:   entry.displayName,
    publisher:     entry.publisher,
    description,
    descriptionIsCv,
    heroCoverUrl,
    volumes,
    editionGroups,
  }
}
