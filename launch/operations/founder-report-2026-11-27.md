# Founder report — 27 November 2026

## Decision: **ready for a limited beta**, not yet for public launch

Pricing is real, fresh and honest today, and the shopper journey works end to
end on phone and desktop. Two things stop it being a public launch, and
neither is cosmetic:

1. **A collector searching a precise edition can fail to find it.** Searching
   *"Berserk Deluxe Edition Volume 1"* returns **"No strong match"**, with the
   correct book at **rank 11**, behind six unrelated titles and four wrong
   Berserk volumes. That is the core promise of the site failing on a real,
   popular query.
2. **Nothing has yet refreshed a price unattended.** Every price on the site
   today was put there by a command run by hand. Hosted scheduling is half
   restored and has not completed a single successful run. Until it does,
   "updates automatically" is an intention, not a fact.

A limited beta is the honest position: the data a beta user sees is accurate
and current, and the known weak spot is discoverability rather than trust.

---

## 1. Comparison depth — before and after

| editions priced at | reported start | now | change |
|---|---|---|---|
| 1 independent retailer  | 3,703 | **3,755** | +52 |
| 2 independent retailers | 43    | **45**    | +2  |
| 3 or more               | 15    | **15**    | 0   |
| **2 or more (total)**   | 58    | **60**    | +2  |

Totals: **3,890** priced listings across **3,815** products (was 3,834 / 3,760).

**How these are counted.** Stored, shopper-visible offers only:
`deleted_at IS NULL AND price_amount > 0`. Independently reproduced by
`npm run launch:health` (`pricedListings 3890`, `productsPriced 3815`,
`comparisonDepth.oneRetailer 3755`, `twoPlusRetailers 60`).

**Live eBay results are NOT in these numbers.** eBay is queried per request and
nothing is stored, by design. Its offers appear in the comparison table *on top
of* the figures above. So a product showing "0 stored offers" can still present
live eBay prices to a shopper — and 60 is therefore a floor on real comparison
depth, not a ceiling.

---

## 2. One row per retailer

| retailer | supplies | eligible coverage | last automatic run | remaining gap |
|---|---|---|---|---|
| waterstones.com | Awin feed 3787 | 3,769 priced | **never** | hourly cron paused; today's data is manual |
| travellingman.com | Shopify verified-offer refresh | 49 priced | **never** | `offer_refresh` first run due 02:00 28 Nov |
| worldofbooks.com | Shopify verified-offer refresh | 40 priced | **never** | as above |
| scholastic.co.uk | Awin feed 2957 | 18 priced | **never** | hourly cron paused |
| letsbuybooks.com | Awin feed 112530 | 14 priced | **never** | hourly cron paused |
| ebay.co.uk / ebay.com | live Browse API per request | 0 stored, by design | n/a — per request | none; verified working |
| uk.bookshop.org | Awin feed 99173 | 0 priced | last observation **2026-08-18 20:54** | feed being rebuilt by Awin; no stale price is shown |
| amazon.co.uk | affiliate links only | 0 priced | last observation 2026-06-26 | Creators API ineligible; no paid API by policy |
| abebooks, whsmith, zavvi | affiliate links only | 0 priced | n/a | no price feed exists for these |
| bookshop.org, wordery.com | templated deep links | 0 priced | wordery last obs 2026-05-25 | link-only by design |

"Last automatic run: never" is literal. Only travellingman.com has ever written
a successful `sync_logs` row (2026-08-18), and `offer_refresh` has no
successful run on record at all.

**Stale sources are not leaking into comparisons.** Bookshop UK, Amazon and
Wordery all have old observation dates and **0 priced rows**, so none of them
contributes a price a shopper could see.

---

## 3. Three production examples a collector can try

**A — multi-retailer comparison (the promise working)**
<https://www.catchcomics.com/product/hitting-rewind-with-you-3-777015>
ISBN 9798888777015 · *Hitting Rewind With You 3*, Kodansha
- Travelling Man — **£10.99**, New, In Stock → travellingman.com *(labelled "Best price")*
- World of Books — £19.19, New, In Stock → worldofbooks.com
- eBay — £11.31, live marketplace result

**B — single tracked retailer, plus a live marketplace offer**
<https://www.catchcomics.com/product/a-sign-of-affection-volume-9-770245>
ISBN 9798888770245 · *A Sign of Affection Volume 9*, Kodansha America
- Waterstones — **£12.99**, New, In Stock → waterstones.com
- eBay — £10.66, New, live marketplace result (excludes postage)

Headed *"Price Comparison (1 tracked retailer)"* with *"All (2)"* — the page is
careful to distinguish a tracked retailer from a marketplace listing.

**C — no stored offer, live eBay fills the gap**
<https://www.catchcomics.com/product/absolute-batman-vol-1-the-zoo-9781799505242>
ISBN 9781799505242 · 0 stored offers · two live eBay offers, both New,
**£19.50** and **£20.99**, with "Prices exclude postage" and the commission
disclosure shown.

Affiliate redirect verified in production: `/go/<id>` returned **HTTP 302 →
`https://travellingman.com/products/absolute-batman-volume-2-`**, destination
preserved.

### One judgement call to confirm, found while checking example B

On example A the **"Best price"** badge sits on Travelling Man £10.99, with
eBay higher at £11.31 — no conflict. On example B there is **no badge**, the
headline reads *"£12.99 at Waterstones"*, and an **eBay offer at £10.66 is
listed directly above it** on the same page.

So "best price" appears to consider **tracked retailers only** and to ignore
marketplace listings. That is defensible — eBay prices exclude postage,
condition varies and the seller is not a retailer we have a relationship with —
and the page does label the distinction. But a collector reading the headline
sees £12.99 with £10.66 visible underneath, which invites the question
"best price according to whom?".

This is a deliberate-looking policy rather than a bug, so I have not changed
it. It is worth a decision: either exclude marketplace offers from the headline
and say so in the label, or let them win the badge with a postage caveat.

### Edition disambiguation (open, minor)

Searching *Absolute Batman* ranks correctly (`weakMatch = false`, the right
book first, flagship assertion intact), but returns **two results both titled
"Absolute Batman Vol. 3"** with different ISBNs (…8915 and …8908), and two
both called "Vol. 1: The Zoo" (…5259 and …5242). They are distinguished only by
ISBN in the URL. A collector cannot tell from the title which one to buy.

---

## 4. Blockers: cause, what shipped, what now detects a recurrence

| blocker | cause | shipped | detection |
|---|---|---|---|
| Site showed no prices | 30-day sweep removed offers kept fresh only by a hand-run script | `offer_refresh` + `offer_health_check` (#54); Awin feeds connected (#56); three imports today | `retailers:health` panel; `offer_health.check` alarm |
| Nothing ran on a schedule | Inngest: two crons paused since 2026-08-09; two never registered after #54 | Diagnosis isolating both faults; run-id instrumentation (#59); diagnostic (#60) | `sync_retailer.scheduled` now writes a row **every tick, including quiet ones** |
| The one independent alarm slept through it | "no retailer link on any page" was a **warning**, and warnings exit 0 | Promoted to a failure (#58) | GitHub Actions emails the founder; verified 21/21 green in CI |
| Dashboard couldn't show a retailer quietly stopping | No per-retailer state at all | Retailers panel (#61) | Five distinct states; only STALE/FAILED/NO DATA styled as faults |
| Search ranks the wrong edition | **Open.** Data, not scoring: Berserk Deluxe 1–10 are `format=OTHER`, `publisher=NULL` | Measurement only (`catalogue:gaps`) | none yet — this is the beta blocker |

### Does an independent monitor catch ONE retailer going stale?

Partly, and the gap is worth knowing precisely.

- **`offer_health_check`** evaluates per-retailer coverage and fires
  `priced-coverage-falling` when it drops. Proven against forced inputs —
  `npm run test:offer-alerts` passes every scenario including "a retailer
  stops responding" — and on the live snapshot it correctly fires
  *"Offer refresh has never completed successfully"*. But it runs **inside
  Inngest**, so it cannot report its own absence.
- **`launch-smoke`** (GitHub Actions — genuinely independent infrastructure,
  emails on failure) only fails when **no sampled product has any retailer
  link**. It would catch a total collapse. It would **not** catch Scholastic
  going stale while Waterstones still works.
- **The Command Centre** now shows per-retailer STALE, but it is a dashboard:
  it tells you when you look, it does not come and find you.

So: one retailer going quiet while others work is **visible but not alarmed**
outside Inngest. A dated, falsifiable test of the detection rule: Travelling
Man and World of Books were last observed 2026-11-26 17:22. If the 02:00
`offer_refresh` does not run, both flip to **STALE at 2026-11-28 17:22** (the
48h bar) while Waterstones stays FRESH — exactly the single-retailer case.
Check `npm run retailers:health` after that time.

### Measured usage today

- **Awin**: 9 feed reads — 3 dry validations, 3 writes, 1 retry after a socket
  close, 1 idempotency re-run, 1 re-validation. Waterstones 153,814 rows
  (~13.7 MB observed on the failed attempt); Scholastic 7,104 rows × 3;
  Lets Buy Books 6,295 rows × 2.
- **ComicVine**: 0 calls. **Open Library / Google Books**: 0 calls.
- **eBay**: live lookups only, incurred per page view, not by this work.
- **Database**: writes confined to `retailer_listings` / `price_history`.
  No writes to `canonical_products`.

**Estimated vs verified cost.** Cost Guard *reports* variable spend MTD
**$26.80**, projected month **$30.75**, burn **$1.48/day**, state AMBER
(reason: stale GitHub provider data; zero restrictions on sync work). These are
the collector's own estimates. **No invoice was observed, so no charge here is
verified.** The Awin feeds, ComicVine, Open Library and eBay Browse are all
free tiers; nothing paid was added.

---

## 5. Owner-only actions

**1. Resume the two paused Inngest crons** — this is the one that matters.
`app.inngest.com` → environment **production** → **Functions** → resume
`sync-retailer-scheduled` and `price-check`.
Until this is done, no Awin feed will ever refresh itself.

**2. Add the Slack webhook.** Vercel → project `catch-comics-v2` → Settings →
Environment Variables → add `SLACK_WEBHOOK_URL` → **then redeploy** (a new
variable does not reach an existing deployment). Note it alerts nothing on its
own until action 1 is done: `raiseAlert()` has only two callers and both are
Inngest functions.

### Note on today's manual imports

Publishing by hand moved every Awin feed's next due time to **~13:35 on
28 November**. So even after you resume the cron, the first *genuinely due*
hosted import for Waterstones, Scholastic and Lets Buy Books is tomorrow
afternoon — not tonight. An hourly tick before then will record a
"nothing was due" row, which is itself the proof the dispatcher is alive.

`offer_refresh` (02:00) and `offer_health_check` (04:00) tonight are unaffected
and will be the first two runs ever to carry an Inngest run ID.

---

## One sentence you can use today

> Catch Comics compares live UK prices on 3,815 comic and manga editions from
> Waterstones, Travelling Man, World of Books, Scholastic, Lets Buy Books and
> eBay — so you can see what a book actually costs before you buy it.

Accurate as written: 3,815 is the number of products with a visible priced
offer, and all six named sources are supplying prices a shopper can see today.
