# eBay relevance gate — plan (not yet built)

**Raised:** 2026-08-24, while diagnosing the founder-review homepage note
*"the price isn't accurate to the cheapest deal when you search through."*
**Severity:** P0 — trust. A different book is presented as the cheapest offer for
the product you are looking at.
**Status:** PLANNED. Founder chose "plan it, don't build today" — a rushed
relevance filter could silently empty the eBay layer across the whole catalogue.
**Scope:** `app/api/ebay/route.ts` (+ `lib/ebay.ts`), product page only. Nothing
on the homepage depends on this.

---

## What is wrong

`app/api/ebay/route.ts` searches eBay by ISBN first. Then:

```ts
// If ISBN returns < 3 results, supplement with title search
if (listings.length < 3 && title) {
  const titleResults = await searchListings(title, 'EBAY_GB', 20)
  // Merge, dedup by itemId       ← merged with NO relevance check
}
```

The merged listings are then sorted **Buy-It-Now first, then price ascending**,
and the cheapest becomes `cheapestBIN` in `components/EbaySection.tsx`, which
drives both the top row of the Price Comparison table and the
"eBay beats all trusted retailers" banner.

eBay's keyword search is fuzzy. A title search for a comic returns the whole
franchise — other volumes, spin-offs, unrelated imprints. Because those land in
the same list and the list is sorted by price, **a cheaper unrelated book is
promoted above the correct one.**

## Evidence (live, 2026-08-24)

`GET /api/ebay?isbn=9781506706665&title=Hellboy%20omnibus`
— that ISBN is Hellboy Omnibus **Volume 1: Seed of Destruction**, the exact
product the homepage rail links to.

| eBay BIN | Condition | Listing title (truncated) | Correct book? |
|---|---|---|---|
| £10.80 | Very Good | Dark Horse Hellboy Omnibus **Vol 2** Strange Places | ✗ |
| £14.50 | Good | HELLBOY Omnibus **Volume 2** STRANGE PLACES | ✗ |
| £17.80 | Very Good | Mike Mignola Hellboy Omnibus **Volume 2** | ✗ |
| £19.49 | Acceptable | **B.P.R.D.** Plague of Frogs Omnibus Volume One | ✗ |

Rendered result on `/product/hellboy-omnibus-706665` — the Price Comparison
table opens with **eBay £10.80** and the one correct, tracked offer
(Bookshop.org, £27.54) sits at the *bottom* of the table.

A collector who clicks the £10.80 row buys the wrong volume.

## Why the obvious fixes are not safe on their own

- **Drop the title fallback entirely** (only merge when the product has no ISBN):
  removes the wrong-book risk immediately, but empties the eBay section for every
  product whose ISBN gets few eBay hits — which is most of the catalogue, since
  UK eBay sellers rarely put the ISBN in the listing title. This trades a trust
  bug for the loss of the marketplace layer.
- **Raise the `< 3` threshold**: does nothing about relevance, just changes how
  often the bug fires.

## Proposed fix

Keep the title fallback, but gate every listing that came from it through a
relevance check before it is allowed into the merged list. ISBN-sourced listings
bypass the gate (an ISBN match is already precise).

1. **Tag the source.** `searchListings` results carry `source: 'isbn' | 'title'`.
2. **Volume gate (the one that matters).** Extract the volume/issue number from
   the canonical product title (`Vol 1`, `Volume 1`, `Vol. 1`, `#1`, `Book One`).
   If the product has a volume number, a title-sourced listing must either state
   the same number or state none at all. A listing that names a *different*
   number is rejected. This alone kills every row in the table above.
3. **Token gate.** Require the listing title to contain the product's
   distinguishing tokens — the series name minus stopwords and format words
   (`omnibus`, `tpb`, `paperback`, `hardcover`, `graphic novel`, `vol`). At least
   N−1 of N significant tokens must appear. This kills "B.P.R.D." on a Hellboy
   page.
4. **Never let a gated-out listing set the banner.** `cheapestBIN` and the
   `ebayWins` comparison in `EbaySection.tsx` must only ever consider listings
   that survived the gate.
5. **Label the residual risk.** Even a passing title-sourced match is weaker
   evidence than an ISBN match. Consider marking those rows so the comparison
   table stays honest about match confidence.

## How to verify it

- New script `scripts/test-ebay-relevance.ts` in the style of
  `scripts/test-ebay-uk-only.ts`, with the four Hellboy rows above as fixtures
  plus at least one **true positive** that must survive the gate.
- Coverage check before/after across a sample of ~200 products: how many lose
  their eBay section entirely? If the drop is large, the gate is too tight —
  loosen the token rule, never the volume rule.
- `npm run test:e2e` — `product.spec.ts` already asserts a real retailer control.

## Acceptance

- Hellboy Omnibus Vol 1 shows no Vol 2 / B.P.R.D. rows.
- The "eBay beats all trusted retailers" banner never fires on a listing that
  failed the gate.
- eBay-section coverage across the sampled catalogue does not fall off a cliff.

## Related

Fixed in the same review, and deliberately kept separate from this: the homepage
rail's price note now says **"Cheapest tracked retailer — eBay may be lower"**
rather than "Live prices from retailers", because `/api/homepage-deals` MINs over
stored `retailer_listings` only and eBay is live-only. That makes the homepage
honest about what its number is; it does not make the eBay layer correct.
