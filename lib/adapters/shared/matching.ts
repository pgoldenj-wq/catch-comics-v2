/**
 * Shared canonical-matching utilities for all platform adapters.
 *
 * Exports:
 *   extractIdentifiers  — parse a barcode string into { isbn13, ean }
 *   makeCanonicalSlug   — title + ISBN → URL-safe slug
 *   matchCanonical      — look up / create a CanonicalProduct row
 *   SyncResult          — return type for every adapter's full sync
 *   SyncError           — error record inside SyncResult
 *   BaseListing         — platform-agnostic listing shape (rawData: unknown)
 */

import { prisma }                                     from '@/lib/prisma'
import { inferFormat, enrichByIsbn, applyEnrichment } from '@/lib/enrichment/isbn'
import { ListingCondition, MatchMethod, Prisma, StockStatus } from '@prisma/client'
import { inngest }                                   from '@/lib/inngest/client'

// ── Shared public types ───────────────────────────────────────────────────────

/**
 * Platform-agnostic listing fields.
 * Each adapter's own NormalizedListing extends / narrows this with a
 * concrete rawData type (e.g. rawData: ShopifyProduct).
 */
export interface BaseListing {
  retailerSku     : string
  retailerUrl     : string
  title           : string
  /** Fixed-precision decimal string, e.g. "12.99" */
  priceAmount     : string
  priceCurrency   : string
  stockStatus     : StockStatus
  condition       : ListingCondition
  conditionDetail : string | null
  imageUrl        : string | null
  isbn13          : string | null
  ean             : string | null
  rawData         : unknown
  canonicalProductId : string | null
  matchMethod     : MatchMethod
  matchConfidence : number
}

export interface SyncResult {
  retailerId      : string
  domain          : string
  pagesFetched    : number
  productsFetched : number
  listingsCreated : number
  listingsUpdated : number
  priceChanges    : number
  errors          : SyncError[]
  durationMs      : number
}

export interface SyncError {
  type    : 'fetch' | 'normalize' | 'upsert' | 'db'
  message : string
  context?: string
}

// ── Barcode / identifier extraction ──────────────────────────────────────────

/**
 * Parse a barcode string into ISBN-13 or EAN.
 *
 * Rules:
 *   13 digits, prefix 978/979 → ISBN-13
 *   13 digits, any other prefix → EAN
 *   Anything else → { isbn13: null, ean: null }
 */
export function extractIdentifiers(barcode: string | null | undefined): {
  isbn13: string | null
  ean:    string | null
} {
  if (!barcode) return { isbn13: null, ean: null }
  const digits = barcode.replace(/\D/g, '')
  if (digits.length !== 13) return { isbn13: null, ean: null }
  if (digits.startsWith('978') || digits.startsWith('979')) {
    return { isbn13: digits, ean: null }
  }
  return { isbn13: null, ean: digits }
}

// ── Canonical slug generation ─────────────────────────────────────────────────

/**
 * Convert a product title + ISBN-13 into a URL-safe canonical slug.
 *
 * Algorithm:
 *   1. Lowercase the title
 *   2. Replace non-alphanumeric characters with hyphens
 *   3. Collapse consecutive hyphens; strip leading/trailing hyphens
 *   4. Append the last 6 digits of the ISBN for global uniqueness
 *
 * Example:
 *   "Absolute Batman Vol. 1: The Zoo", "9781779527226"
 *   → "absolute-batman-vol-1-the-zoo-527226"
 */
export function makeCanonicalSlug(title: string, isbn13: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
  return `${base}-${isbn13.slice(-6)}`
}

// ── Canonical product matching ────────────────────────────────────────────────

/**
 * Given ISBN-13 / EAN / title, return a canonical product match.
 *
 * Strategy:
 *   1. ISBN-13 lookup → existing canonical product (confidence 95)
 *   2. ISBN-13 miss  → create stub canonical product (confidence 80)
 *      a. Inline enrichment via Google Books / Open Library
 *      b. P2002 race → findFirst the winner
 *   3. EAN-only lookup (no auto-creation — EANs are not reliably book IDs)
 *   4. No match → UNMATCHED (confidence 0)
 *
 * @param adapterTag  Short label for log lines, e.g. "[shopify]"
 */
export async function matchCanonical(
  isbn13     : string | null,
  ean        : string | null,
  title      : string,
  adapterTag = '[adapter]',
): Promise<Pick<BaseListing, 'canonicalProductId' | 'matchMethod' | 'matchConfidence'>> {

  if (isbn13) {
    // ── 1. Look up existing canonical product by ISBN ─────────────────────
    const existing = await prisma.canonicalProduct.findFirst({
      where:  { isbn13 },
      select: { id: true },
    })
    if (existing) {
      return { canonicalProductId: existing.id, matchMethod: MatchMethod.ISBN, matchConfidence: 95 }
    }

    // ── 2. No existing match — create a stub canonical product ────────────
    const format = inferFormat(title) ?? 'OTHER'
    const slug   = makeCanonicalSlug(title, isbn13)

    try {
      const created = await prisma.canonicalProduct.create({
        data: {
          isbn13,
          title,
          format,
          canonicalSlug: slug,
          isbn10:        null,
          ean:           null,
          comicvineId:   null,
          subtitle:      null,
          publisher:     null,
          seriesName:    null,
          volumeNumber:  null,
          issueNumber:   null,
          releaseDate:   null,
          coverImageUrl: null,
          description:   null,
        },
        select: { id: true },
      })
      console.log(`${adapterTag} created canonical product "${title}" (${isbn13}) → ${created.id}`)

      // ── Inline enrichment ─────────────────────────────────────────────────
      try {
        const enrichResult = await enrichByIsbn(isbn13)
        if (enrichResult.source !== 'none') {
          const applied = await applyEnrichment(created.id, enrichResult)
          console.log(
            `${adapterTag} enriched stub ${isbn13} via ${enrichResult.source}` +
            ` — fields written: ${applied ? 'yes' : 'none (already complete)'}`,
          )
        } else {
          console.log(
            `${adapterTag} no enrichment data found for ${isbn13} — bulk job can retry`,
          )
        }
      } catch (enrichErr) {
        console.warn(
          `${adapterTag} enrichment failed for ${isbn13} — stub kept sparse, bulk job can retry:`,
          enrichErr instanceof Error ? enrichErr.message : enrichErr,
        )
      }

      // ── Queue Bookshop.org lookup in the background ───────────────────────
      // Non-blocking: if Inngest is not configured this fails silently.
      try {
        await inngest.send({
          name: 'bookshop/lookup',
          data: { isbn13, canonicalProductId: created.id },
        })
      } catch {
        // Inngest not reachable in this context (e.g. CLI script) — ignore.
      }

      return { canonicalProductId: created.id, matchMethod: MatchMethod.ISBN, matchConfidence: 80 }

    } catch (err) {
      // P2002: another concurrent sync created this ISBN between findFirst and create
      const isUniqueViolation =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'

      if (isUniqueViolation) {
        const race = await prisma.canonicalProduct.findFirst({
          where:  { isbn13 },
          select: { id: true },
        })
        if (race) {
          return { canonicalProductId: race.id, matchMethod: MatchMethod.ISBN, matchConfidence: 80 }
        }
      }
      throw err
    }
  }

  // ── EAN-only match (lookup only — no auto-creation) ───────────────────────
  if (ean) {
    const hit = await prisma.canonicalProduct.findFirst({
      where:  { ean },
      select: { id: true },
    })
    if (hit) {
      return { canonicalProductId: hit.id, matchMethod: MatchMethod.EAN, matchConfidence: 90 }
    }
  }

  return { canonicalProductId: null, matchMethod: MatchMethod.UNMATCHED, matchConfidence: 0 }
}
