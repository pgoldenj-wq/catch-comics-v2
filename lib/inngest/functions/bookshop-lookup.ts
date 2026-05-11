/**
 * bookshop/lookup — background ISBN lookup on Bookshop.org.
 *
 * Triggered by the shared/matching.ts canonical creation hook whenever a new
 * canonical product is auto-created from a retailer listing.
 *
 * This keeps the sync path fast: instead of calling Bookshop.org inline (which
 * would add ~2 s per new product), we fire this event and let Inngest pick it
 * up asynchronously.
 *
 * Retries: 3. Concurrency: 3 (respect Bookshop.org rate limits).
 */

import { inngest }      from '@/lib/inngest/client'
import { lookupByIsbn } from '@/lib/adapters/bookshop'

export const bookshopLookup = inngest.createFunction(
  {
    id         : 'bookshop-lookup',
    name       : 'Bookshop.org ISBN Lookup',
    retries    : 3,
    concurrency: { limit: 3 },
    triggers   : [{ event: 'bookshop/lookup' }],
  },
  async ({ event }) => {
    const { isbn13, canonicalProductId } = event.data as {
      isbn13            : string
      canonicalProductId: string
    }

    const results = await lookupByIsbn(isbn13, canonicalProductId)

    const found = results.filter(r => r.found).length
    const total = results.length

    return {
      isbn13,
      canonicalProductId,
      found,
      total,
      results: results.map(r => ({
        market  : r.market,
        outcome : r.outcome,
        price   : r.priceAmount ? `${r.currency} ${r.priceAmount}` : null,
      })),
    }
  },
)
