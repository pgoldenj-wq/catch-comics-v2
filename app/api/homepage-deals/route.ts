import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/homepage-deals
 *
 * Returns up to 12 canonical products that have at least one in-stock listing,
 * ordered by number of listings DESC (most-listed = most popular / best value).
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
    // Raw SQL — joins canonical_products with in-stock retailer_listings,
    // picks the cheapest GBP and USD price for each product,
    // orders by listing count (popularity proxy) DESC.
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
      SELECT
        cp.canonical_slug          AS slug,
        cp.title,
        cp.publisher,
        cp.format,
        cp.cover_image_url,
        COUNT(rl.id)               AS listing_count,
        MIN(CASE WHEN rl.price_currency = 'GBP' THEN rl.price_amount::numeric ELSE NULL END) AS lowest_gbp,
        MIN(CASE WHEN rl.price_currency = 'USD' THEN rl.price_amount::numeric ELSE NULL END) AS lowest_usd
      FROM canonical_products cp
      INNER JOIN retailer_listings rl
        ON rl.canonical_product_id = cp.id
        AND rl.stock_status = 'IN_STOCK'
        AND rl.deleted_at IS NULL
      WHERE (
        cp.format IN ('SINGLE_ISSUE','MANGA_VOLUME','OMNIBUS','ABSOLUTE','COMPENDIUM','DELUXE')
        OR (
          cp.format IN ('TPB','HARDCOVER')
          AND cp.publisher IN (
            'DC Comics','Marvel','Image Comics','Dark Horse Comics','Viz Media',
            'IDW Publishing','BOOM! Studios','Valiant','Dynamite','Oni Press',
            'Fantagraphics','Drawn & Quarterly','Top Shelf','Archie Comics',
            'Slave Labor Graphics','Avatar Press','Titan Comics','Rebellion',
            'Panini','Kodansha','Shueisha','Shogakukan','Square Enix','Yen Press',
            'Seven Seas','Tokyopop','Del Rey Manga','Vertical','Udon','Antarctic Press'
          )
        )
      )
      GROUP BY cp.id, cp.canonical_slug, cp.title, cp.publisher, cp.format, cp.cover_image_url
      HAVING COUNT(rl.id) >= 1
      ORDER BY listing_count DESC
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
