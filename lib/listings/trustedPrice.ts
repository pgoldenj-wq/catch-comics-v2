/**
 * lib/listings/trustedPrice.ts — one definition of "a price we may show".
 *
 * Founder review 2026-08-31: /search?q=absolute+batman showed "Other listings"
 * rows priced £0.00. They are not free comics. They are stub rows from general
 * book retailers whose feed carried no price, and 25,816 of the 26,591 live
 * unmatched listings (97%) are in that state. Worse, 47,302 offers priced <= 0
 * are attached to real canonical products across 22,858 of them — and search
 * ranks a product's offers by `price_amount ASC`, so a £0.00 stub sorts FIRST
 * and becomes the "From £..." the shopper is quoted.
 *
 * A price of zero is missing data wearing a number's clothes. Presenting it is
 * worse than showing nothing: it invents a cheapest offer, satisfies an
 * "Under £X" filter it has no right to, and sends the shopper to a retailer
 * page that will not honour it.
 *
 * Note this is about OFFER prices from retailer feeds. If Catch Comics ever
 * lists something genuinely free (a Free Comic Book Day giveaway, say), it
 * needs its own explicit zero-cost representation rather than being smuggled
 * in through an absent price — which is exactly what this rejects.
 */

/** The least a real retail offer can cost. Below this it is missing data. */
export const MIN_TRUSTED_PRICE = 0.01

/**
 * Is this a price we may show a shopper as a current, purchasable amount?
 *
 * Rejects null/undefined, NaN, Infinity, negatives and zero. Accepts a string
 * because Prisma hands Decimal columns back as strings from raw queries.
 */
export function isTrustedPrice(value: unknown): boolean {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n >= MIN_TRUSTED_PRICE
}

/**
 * The SQL predicate form, so the rule is enforced in the query rather than
 * after it — a £0.00 row that never leaves Postgres cannot sort itself to the
 * front of an offer list on the way out.
 */
export const TRUSTED_PRICE_SQL = `price_amount >= ${MIN_TRUSTED_PRICE}`
