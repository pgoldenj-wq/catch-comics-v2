# Price fuse — cheapest safe refresh plan

Measured 2026-08-23. All figures below are from live queries and live probes
made while writing this, not from prior audit notes.

## The fuse, re-measured

| | |
|---|---|
| Catalogue | 150,694 |
| Products with a priced offer | 32,250 |
| …with 2+ non-eBay retailers | **17** |
| …with 3+ | 0 |
| Stored prices expire | 2026-08-23 → 2026-09-17 |

`cleanup-stale` ran at 03:00 today and soft-deleted 13,123 listings; it has
been removing 7,900–14,800 a day all week. The fuse is burning now.

## What is actually expiring

**World of Books — 31,355 visible priced listings, last seen 2026-08-09,
all gone by 2026-09-08.** Shopify `product_type` breakdown of those rows:

| product_type | rows |
|---|---|
| Book | 30,619 |
| Music | 566 |
| DVD | 143 |
| Games | 27 |

Listings whose canonical product carries **any** comic evidence (ComicVine id,
CV metadata, or a comic publisher): **34**. Titles containing
"comic"/"manga"/"graphic novel": **16**. A random sample of 15 returned
*Recueil Militair*, *Das Eigenthum In Seiner Sozialen Bedeutung (1879)*,
*Year Books of the Reign of King Edward the First; Volume 4*.

World of Books is not a comic price source. It is 31,000 rows of general and
academic stock plus 736 music/DVD/games rows, and it is the only reason the
"32,250 priced products" number looks large.

**Travelling Man — 2,247 visible priced listings, 1,471 ComicVine-identified,
expiring 2026-09-17.** This is the real comic pricing.

**Overlap between the two: 1 product.** Refreshing both preserves what exists;
it does not create comparison depth. Depth is a separate problem.

## The hidden asset

6,663 Travelling Man listings are soft-deleted but were re-seen by the
2026-08-18 recovery pass — the pass updated `last_seen_at` but nothing in the
Shopify upsert path clears `deleted_at`, so they stayed invisible. They were
soft-deleted on 2026-07-04, while the sync was down.

- 4,436 of the 6,663 sit on ComicVine-identified comic products
- 52 are unmatched
- 5/5 sampled live today: HTTP 200, still on sale, price identical to stored
  (*Rent-A-Girlfriend Vol 19* £8.99, *My New Life as a Cat Vol 2* £5.99, …)

Travelling Man's true comic inventory is ~8,909 listings, not 2,247. Reviving
rows confirmed present in a **complete** traversal is evidence-based
restoration of already-matched rows — no new products, no new matches, no
loosening of identity.

## Live reachability (probed today)

| Endpoint | Result |
|---|---|
| `worldofbooks.com/products.json?limit=250&page=1` | 503, then **200 (408 KB)** minutes later |
| `worldofbooks.com/products/<handle>.js` × 12 | **12/12 200**, avg 2,053 B, 11/12 prices unchanged |
| `travellingman.com/products.json?limit=250&page=1` | 200, 745 KB |
| `travellingman.com/products/<handle>.js` | 200, 3 KB |

The "World of Books blocks every public path" note is **stale** — the 503s are
transient Shopify throttling, and the adapter already backs off on 5xx. What
remains true is that a *full* WoB traversal is impossible: 190k live products
against Shopify's 25,000 (page 100 × 250) pagination ceiling. That, not
blocking, is why its scheduled sync must stay off.

## Bounded costs

| Option | Requests | Inbound | Wall clock | Inngest execs | £ |
|---|---|---|---|---|---|
| A. Travelling Man complete pass (CLI) | ~103 pages | ~77 MB | ~4 min | **0** | 0 |
| B. WoB comic-only refresh, per handle | ~34 | ~70 KB | <1 min | **0** | 0 |
| C. WoB full refresh, per handle | 31,355 | ~64 MB | ~9 h @ 1 req/s | 0 | 0 |

DB cost for A: ~25,750 upserts + one bounded `deleted_at` clear. No
`canonical_products` writes, so it cannot collide with the enrichment job.
Neon egress is writes, not the 30 MB candidate reads that caused the July RED.

## Recommendation

1. **Do A.** Re-run the proven no-create pass
   (`scripts/sync-tm-recover.ts --dry-run` first, then `--write`). It already
   refuses to reconcile unless traversal proved complete.
2. **Add a revive step to A, gated on traversal completeness**: clear
   `deleted_at` only for rows the complete pass actually saw. 2,247 → ~8,909
   priced comic listings, CV-identified 1,471 → ~5,900, for zero extra
   requests. Dry-run must print the exact row count before any write.
3. **Do B** — 34 requests, effectively free, keeps the handful of genuine WoB
   comic offers alive.
4. **Do not do C.** Nine hours of scraping to preserve 30,619 academic books,
   566 music, 143 DVD and 27 games rows on a comic site. Letting them expire
   is the correct product outcome; the "priced products" count will fall from
   32,250 to roughly 1,000–9,000 and that number will finally be honest.
5. **Set `scheduled_sync_disabled: true` on Travelling Man.** It is currently
   unset, so TM is enqueued the moment the Inngest cron is un-paused. Keep the
   CLI as the only path until the resume criteria below are met.

## Do not resume the Inngest schedule

Evidence it is off: zero `sync_logs` rows since 2026-08-09 12:00, while
`enrich.canonical_products` (02:00), `cleanup.stale_listings` (03:00) and
`bookshop.refresh` (04:00) have run every day since. The hourly
`sync-retailer-scheduled` and 4-hourly `price-check` are paused at the
platform. Cost Guard: GREEN.

Nothing in this plan needs them. Both options run as direct CLI at **0
executions**, so resumption stays a separate decision.

Criteria before anyone un-pauses, all four:
1. `npm run test:sync-backoff`, `test:traversal-safety`, `test:price-check`,
   `test:containment` green — these cover the in-flight lease, the doubling
   failure cooldown, and the shared dispatch predicate from PR #24.
2. World of Books stays `scheduled_sync_disabled`. Its sync can never complete
   (190k catalogue vs 25k ceiling), and "never completes" is precisely the
   condition that made `lastSyncedAt` stay null and re-enqueue forever.
3. Only retailers whose sync has *actually completed* on the CLI path are
   eligible for the schedule.
4. One hour of observation after un-pausing, with `sync_logs` row count checked
   against expectation before leaving it running.

## Not doing

- No loosening of identity matching. Nothing here creates a product, a stub, or
  a match; every touched row is already matched.
- No spoofed user agents against World of Books. Probes used the declared
  `CatchComics/1.0 (+https://catchcomics.com/bot)` agent and stayed under
  1 req/s.
- No paid Amazon API, no Rainforest.

---

# ADDENDUM — dry-run result 2026-08-23 19:06 UTC (Option A is FALSIFIED)

Commit `9c63b2b`, branch `main`. Report:
`launch/operations/tm-revival-dryrun-latest.json`.

**Traversal completeness: FAIL.** Travelling Man returned a **full** 250-product
page 100, then HTTP 400 — Shopify's 25,000 (page 100 × 250) pagination ceiling.
By the existing `isTraversalComplete('http-400', lastPageWasFull=true)` rule
that is truncation, not completion. **Proposed revivals: 0.**

The "~103 pages, complete pass, ~4 min" estimate in Option A above was wrong.
Travelling Man is no longer a ~90-page catalogue; it now exceeds 25,000
products and hits **the same structural blocker as World of Books**, just at a
smaller scale. The 2026-08-18 run that logged `success` cannot have proved
completeness either.

Also found: `sync-tm-recover.ts --dry-run` returns *before any network call*
(`if (!WRITE) { … return }`), so it makes 0 requests and classifies nothing.
Its only traversal path is `--write`. The classification above came from
`scripts/tm-revival-dryrun.ts`, a read-only harness that reuses the adapter's
own `previewRetailer` (same UA, backoff, page size, normalisation) and the
same completeness guard, with zero writes.

And: **the revival behaviour does not exist in code.** Nothing in the Shopify
upsert path clears `deleted_at`. A `--write` run today would refresh prices and
`last_seen_at` and leave all 23,517 soft-deleted rows invisible — which is
exactly what happened on 2026-08-18.

Observed counts (pre-comic-filter; TM has `comic_filter: true`, so a real
write would touch fewer):

| | |
|---|---|
| Products traversed | 25,000 (100 pages) |
| Requests | 101 of 150 ceiling |
| Stored rows re-seen | 23,464 |
| …active → normal refresh | 2,246 (price differs on 6) |
| …soft-deleted → revival-eligible **had traversal passed** | 21,218 |
| ComicVine-identified within that set | 4,462 |
| Soft-deleted not re-seen | 2,299 (proves nothing — traversal incomplete) |
| Feed SKUs with no stored row | 1,536 → proposed inserts **0** |
| Proposed revivals / inserts / canonical creations / identity changes | **0 / 0 / 0 / 0** |

Next step is **not** a write. A complete enumeration route must exist first —
Travelling Man publishes 38 product sitemaps (`sitemap_products_N.xml`), which
are not subject to the 25,000 pagination ceiling and would give an exact,
provable catalogue set. Build that, re-run this dry-run, and only then consider
a revival write.

---

# ADDENDUM 2 — sitemap enumeration, dry-run PASS (2026-08-23 20:38 UTC)

Enumeration source switched from `/products.json` pagination to Travelling
Man's published sitemaps. Script: `scripts/tm-revival-dryrun.ts`. Report:
`launch/operations/tm-revival-dryrun-latest.json`.

**Completeness: PASS.** 38/38 product sitemaps fetched, 37,782 distinct product
handles. That figure is itself the proof of the earlier failure — the catalogue
is 37,782 products, so legacy pagination could never see past 25,000.

Sitemaps carry `<loc>`, `<lastmod>`, `<changefreq>` and `<image:image>` only —
**no price, no availability**. They establish catalogue MEMBERSHIP. Rows are
joined to the catalogue by the product handle already stored in
`retailer_listings.retailer_url`; no matcher runs, no identity logic changes.

| Measure | Count |
|---|---|
| Sitemap files discovered / fetched | 38 / 38 |
| Catalogue URLs / distinct handles | 37,782 / 37,782 |
| HTTP requests / inbound / wall clock | 39 / 17.4 MiB / 95.8 s |
| Stored rows re-seen | 25,561 of 25,764 |
| Active → would refresh | 2,246 |
| Soft-deleted re-seen → revival candidates | 23,315 |
| …ComicVine-identified | 5,285 |
| …unmatched | 15,469 |
| Soft-deleted not re-seen | 202 |
| Active not re-seen | 1 |
| Catalogue handles with no stored row | 12,221 → proposed inserts **0** |
| Proposed inserts / canonical creations / identity changes | **0 / 0 / 0** |
| Writes / Inngest executions | **0 / 0** |

## Do not revive all 23,315

Membership is not stock, and it is not price. Of the 23,517 soft-deleted rows,
~16,853 carry prices last verified in **May 2026**, 761 in June, and 6,663 on
18 August. Reviving the full set would republish three-month-old prices on a
price-comparison site — a trust failure worse than showing nothing.

A price refresh needs one `/products/<handle>.js` per row:

| Scope | Requests | Time @1/s | Inbound |
|---|---|---|---|
| All re-seen rows | 25,561 | ~7 h | ~73 MiB |
| ComicVine-identified candidates + active | ~7,531 | ~2 h | ~22 MiB |
| Active rows only | 2,246 | ~37 min | ~6 MiB |

**Zero per-product requests were issued in this task**, by the
`MAX_PRODUCT_REQUESTS = 0` bound.

Recommended next scope when a write is authorised: ComicVine-identified
candidates plus active rows, price-verified before any `deleted_at` is cleared,
with revival conditional on the per-product fetch returning `available: true`.

---

# ADDENDUM 3 — live price verification, DRY RUN (2026-08-23 20:46–21:30 UTC)

Script: `scripts/price-verify-dryrun.ts`. Report:
`launch/operations/price-verify-dryrun-latest.json`. Zero writes, zero Inngest.

Membership came from the completed 38/38 sitemap enumeration (37,782 handles).
`/products.json` was not used. Identity was the stored one throughout: exact
variant for `pid-vid` rows with no substitution, the adapter's existing primary
rule for `pid` rows, and the live product id had to equal the stored one.

| | Travelling Man | World of Books |
|---|---|---|
| Target rows | 2,246 (1 active row excluded — not in sitemap) | 34 |
| Rows attempted / verified | 2,246 / **2,246** | 34 / **34** |
| Available, price unchanged | 1,600 | 18 |
| Available, price **changed** | 4 | 1 |
| Unavailable | 642 | 15 |
| Stored variant missing | 0 | 0 |
| Product id mismatch | 0 | 0 |
| 404 | 0 | 0 |
| Transient / throttle | **0** | **0** |
| Other errors | 0 | 0 |
| Safe for a subsequent write | 2,246 | 34 |

2,280 product requests, **0 retries, 0 transient failures** — both stores
tolerated 1 req/s sequential comfortably. 39 sitemap requests. 24.49 MiB
inbound. 44.3 minutes.

**Prices are stable; availability is not.** Only 5 of 2,280 rows changed price.
But 642 of 2,246 TM rows (28.6%) and 15 of 34 WoB rows are currently
unavailable. Stored TM stock says 1,584 IN_STOCK / 663 OUT_OF_STOCK; live says
1,604 available / 642 unavailable across the target set — a net ~20 rows would
return to in-stock, and the real value of a write is the freshness clock, not
the prices.

Zero-write proof: before/after snapshots of listing counts, active/deleted,
`max(last_seen_at)`, `SUM(price_amount)`, `lastSyncedAt`, `sync_logs`
count/latest, and `canonical_products` were byte-identical.

The 23,315 soft-deleted TM rows were not touched and are not proposed for
revival here.

---

# ADDENDUM 4 — BOUNDED PRODUCTION WRITE EXECUTED (2026-08-23 21:44–22:32 UTC)

Branch `fix/retailer-price-fuse-bounded-refresh` off `9c63b2b`. Report:
`launch/operations/price-verify-write-latest.json`.

Containment first: `scripts/disable-tm-scheduled-sync.ts` set Travelling Man
`scheduled_sync_disabled: true`. `comic_filter: true` and `prev_missing_skus`
survived (keys 2 → 3). No other retailer's config was touched.

Then one bounded write run — every row re-verified live in that same run
immediately before its write.

| | Travelling Man | World of Books |
|---|---|---|
| Target rows | 2,246 | 34 |
| Reverified in-run | 2,246 | 34 |
| **Rows written** | **2,246** | **34** |
| Available, price unchanged | 1,599 | 18 |
| Available, price changed | 4 | 1 |
| Unavailable | 643 | 15 |
| Variant missing / id mismatch / 404 / transient / other | 0 / 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 / 0 |

Seven `price_history` rows were appended — six TM, one WoB. That exceeds the
"4 + 1 available price changes" because two rows changed price *and* were
unavailable; the price observation is still genuine, so it is recorded.

Reconciliation against the run-start boundary (21:44):

- TM active rows freshened **2,246**; soft-deleted rows freshened **0**; max
  `last_seen_at` among soft-deleted still 2026-08-18 — none of the 23,315 was
  revived or touched.
- WoB active rows freshened **34**; the other 83,044 WoB active rows still sit
  at 2026-08-09 and expire as intended.
- The 1 excluded TM row (*The Ancient Magus' Bride Volume 23*, absent from the
  sitemap) is untouched at 2026-07-31.
- `retailer_listings` 808,344 → 808,344. `canonical_products` 150,694 →
  150,694. `sync_logs` created: **0**. `lastSyncedAt` unchanged on both
  retailers — this was a bounded refresh, not a complete sync.
- TM stock 1,584 → 1,603 in-stock; WoB 81,417 → 81,415.

Cost: 39 sitemap + 2,280 product requests, **0 retries, 0 transient failures**,
24.49 MiB, 47.7 minutes, 0 Inngest executions, £0 external.

Production spot check (5 pages) matched the database exactly, including all
three visible price moves. `pok-cology-…-833541` now shows a real two-retailer
comparison: Travelling Man £14.99 vs World of Books £21.39.
