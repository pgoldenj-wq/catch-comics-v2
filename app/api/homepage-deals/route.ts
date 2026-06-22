import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/homepage-deals
 *
 * Returns up to 12 canonical products that have at least one in-stock listing,
 * ordered by number of listings DESC (most-listed = most popular / best value).
 *
 * Only comic-native formats appear on the homepage:
 *   - SINGLE_ISSUE, MANGA_VOLUME — inherently comic, allowed unconditionally
 *   - OMNIBUS / ABSOLUTE / COMPENDIUM / DELUXE / TPB / HARDCOVER — only when the
 *     publisher is a known comics publisher (these collected-edition formats get
 *     mis-tagged onto prose classics like "Anna Karenina Deluxe" / "Complete Sherlock Holmes")
 *   (prevents board games, RPG books, prose classics, and ambiguous OTHER formats from surfacing)
 *
 * Filters:
 *   - cover_image_url IS NOT NULL  (a visual carousel demands images)
 *   - deleted_at IS NULL           (live products only)
 *
 * Series dedup: many series have several canonical_products that share
 * essentially the same title ("Destroy All Humans" Vol 1/2/3 etc.). The
 * CTE picks ONE representative per series (best per dedup_key), so the
 * carousel shows 12 distinct series rather than 12 near-duplicate cards.
 *
 * dedup_key = normalised series_name when present, otherwise first 40
 * normalised chars of the title. Within a key, the highest listing_count
 * (then newest release date) wins.
 *
 * Response shape:
 *   { deals: DealItem[] }
 *
 * Cached for 15 minutes at the CDN edge. Re-runs on each Vercel deployment.
 */

export const revalidate = 900 // 15 minutes

export interface HomepageDeal {
  slug:         string
  title:        string
  publisher:    string | null
  format:       string
  coverImageUrl:string | null
  lowestPriceGBP: number | null
  lowestPriceUSD: number | null
}

export async function GET() {
  try {
    // Two-stage CTE:
    //   per_product  — one row per canonical product, with listing_count + prices
    //   ranked       — assigns rank within each series dedup_key
    // Final select keeps rank=1 per series, ordered by listing_count.
    const rows = await prisma.$queryRaw<Array<{
      slug:          string
      title:         string
      publisher:     string | null
      format:        string
      cover_image_url: string | null
      listing_count: bigint
      lowest_gbp:    number | null
      lowest_usd:    number | null
    }>>`
      WITH per_product AS (
        SELECT
          cp.id,
          cp.canonical_slug,
          cp.title,
          cp.publisher,
          cp.format,
          cp.cover_image_url,
          cp.release_date,
          -- Dedup key: normalised series_name when present, else first 40
          -- normalised chars of the title. Strips punctuation/whitespace so
          -- "Destroy All Humans -" and "Destroy All Humans-" collapse together.
          SUBSTRING(
            LOWER(REGEXP_REPLACE(
              COALESCE(NULLIF(TRIM(cp.series_name), ''), TRIM(cp.title)),
              '[^a-zA-Z0-9]+', '', 'g'
            )),
            1, 40
          ) AS dedup_key,
          COUNT(rl.id) AS listing_count,
          MIN(CASE WHEN rl.price_currency = 'GBP' THEN rl.price_amount::numeric END) AS lowest_gbp,
          MIN(CASE WHEN rl.price_currency = 'USD' THEN rl.price_amount::numeric END) AS lowest_usd
        FROM canonical_products cp
        INNER JOIN retailer_listings rl
          ON rl.canonical_product_id = cp.id
          AND rl.stock_status = 'IN_STOCK'
          AND rl.deleted_at IS NULL
        WHERE cp.deleted_at IS NULL
          -- Issue 4: visual carousel demands images. Also exclude known placeholder
          -- URLs (mirrors lib/images/url-filters.isBadCoverUrl) so a homepage slot is
          -- never spent on a product whose only "cover" is a placeholder.
          AND cp.cover_image_url IS NOT NULL
          AND cp.cover_image_url NOT ILIKE '%no_image%'
          AND cp.cover_image_url NOT ILIKE '%not_available%'
          AND cp.cover_image_url NOT ILIKE '%books.google.com%'
          AND cp.cover_image_url !~ '/uploads/[^/]+/0/[0-9]+/'
          AND (
            -- SINGLE_ISSUE and MANGA_VOLUME are inherently comic — allow unconditionally.
            cp.format IN ('SINGLE_ISSUE','MANGA_VOLUME')
            -- Collected-edition formats get mis-tagged onto prose classics
            -- ("Anna Karenina Deluxe", "Complete Sherlock Holmes Omnibus"), so they must
            -- come from a known comics publisher — the same gate TPB/HARDCOVER already use.
            OR (
              cp.format IN ('OMNIBUS','ABSOLUTE','COMPENDIUM','DELUXE','TPB','HARDCOVER')
              AND cp.publisher IN (
                'DC Comics','DC Black Label','Marvel','Marvel Comics','Image Comics',
                'Dark Horse Comics','Dark Horse Books','Dark Horse Manga','Viz Media','VIZ Media LLC',
                'IDW Publishing','BOOM! Studios','BOOM! Box','Valiant','Dynamite','Oni Press',
                'Fantagraphics','Drawn & Quarterly','Drawn and Quarterly','Top Shelf','Archie Comics',
                'Slave Labor Graphics','Avatar Press','Titan Comics','Rebellion',
                'Panini','Kodansha','Kodansha Comics','Kodansha USA','Shueisha','Shogakukan',
                'Square Enix','Square Enix Manga','Yen Press','Yen On',
                'Seven Seas','Tokyopop','Del Rey Manga','Vertical','Udon','Udon Entertainment',
                'Antarctic Press','Scholastic','Graphix','First Second','Humanoids',
                'Lion Forge','Papercutz','Ablaze','Vault Comics','Abrams ComicArts'
              )
            )
          )
        GROUP BY cp.id, cp.canonical_slug, cp.title, cp.publisher, cp.format,
                 cp.cover_image_url, cp.release_date, cp.series_name
        HAVING COUNT(rl.id) >= 1
      ),
      ranked AS (
        SELECT
          *,
          ROW_NUMBER() OVER (
            PARTITION BY dedup_key
            -- Prefer the representative with a real (R2) cover: Open Library
            -- fallback URLs frequently 404, leaving grey placeholder cards.
            ORDER BY (cover_image_url LIKE 'https://images.catchcomics.com%') DESC,
                     listing_count DESC, release_date DESC NULLS LAST
          ) AS series_rank
        FROM per_product
      )
      SELECT
        canonical_slug   AS slug,
        title,
        publisher,
        format,
        cover_image_url,
        listing_count,
        lowest_gbp,
        lowest_usd
      FROM ranked
      WHERE series_rank = 1                    -- Issue 3: one row per series
      -- Surface real-cover (R2) products first so the carousel never shows a
      -- wall of grey placeholders; listing_count keeps the most-listed within each tier.
      ORDER BY (cover_image_url LIKE 'https://images.catchcomics.com%') DESC, listing_count DESC
      LIMIT 12
    `

    const deals: HomepageDeal[] = rows.map(r => ({
      slug:            r.slug,
      title:           r.title,
      publisher:       r.publisher,
      format:          r.format,
      coverImageUrl:   r.cover_image_url,
      lowestPriceGBP:  r.lowest_gbp ? Number(r.lowest_gbp) : null,
      lowestPriceUSD:  r.lowest_usd ? Number(r.lowest_usd) : null,
    }))

    return NextResponse.json({ deals }, {
      headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800' },
    })
  } catch (err) {
    console.error('[/api/homepage-deals] error:', err)
    // Return empty — homepage falls back to static TOP_DEALS
    return NextResponse.json({ deals: [] })
  }
}
