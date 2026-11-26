# Second retailer feed — scope

> ## ⚠️ CORRECTED LATER THE SAME DAY — read this first
>
> **This document's central claim about Awin is wrong.** It says a Waterstones
> or Wordery feed is blocked because `AWIN_API_TOKEN` is unset, and calls that
> "a commercial decision with a lead time".
>
> `AWIN_API_TOKEN` is referenced in exactly one file in this repository —
> `scripts/b4-scope-second-feed.ts`, which this same piece of work added. **No
> adapter reads it.** The credential the Awin feed adapter actually uses is
> `AWIN_DATAFEED_KEY`, and it was set the whole time. The publisher account has
> **578 joined Awin feeds**, including **Waterstones (feed 3787, 153,576
> products, rebuilt daily)**.
>
> I checked a variable name instead of exercising the connection. Waterstones,
> Scholastic and Lets Buy Books were connected on 2026-11-26 with no commercial
> conversation and no new spend, taking priced listings from 89 to 3,833.
>
> What this document got right: World of Books was a sound first pair, Wordery
> genuinely has no feed on this account, and the per-row `deleted_at` scoping
> and cron-window rules were correct and are now in the adapter.
>
> Current state: **`launch/operations/retailer-access-2026-11-26.md`**.

**Written 2026-11-26. Read-only measurement; nothing in here has been executed.**

Reviving Travelling Man restored *prices* (0 → 10 priced listings). It did not
restore *comparison*: **0 products are priced at 2+ retailers**, so B4's done
condition is still unmet. This scopes the remaining half.

**Recommendation: World of Books.** Proven reachable today, no new adapter, no
new cron, and the daily refresh shipped in PR #54 already covers it.

---

## The candidates, measured

`npm run b4:scope-second-feed` (read-only). Overlap is against the 2,236 rows
still soft-deleted from the 27 October sweep.

| retailer | platform | editions shared | priced rows | reachable? |
|---|---|---|---|---|
| Waterstones | DIRECT_AFFILIATE | 1,792 | 1,278 | **No** — in `SKIP_PLATFORMS`, no feed adapter exists |
| Bookshop.org (UK) | DYNAMIC_LINK | 1,716 | 14 | Yes, but see below |
| Wordery | DYNAMIC_LINK | 1,479 | 1,091 | **No** — 403 + Cloudflare challenge under an honest UA |
| Amazon UK | EXTERNAL_API | 343 | 338 | **No** — Rainforest retired 2026-07-13, affiliate-only |
| **World of Books** | **SHOPIFY** | **170** | **168** | **Yes — verified live today** |

World of Books has the *smallest* overlap and is still the right answer,
because it is the only one that is both verifiable and honest.

### Proven live, 2 of 2 probed

`npm run b4:probe-second-feed` — 4 requests, honest UA, zero writes:

| edition | World of Books | Travelling Man |
|---|---|---|
| BOSS, BXTCH, BABY Volume 1 | £22.89 (`availablePriceChanged`) | £14.99 |
| The Perks of Being an S-Class Heroine Volume 7 | £23.59 (`availablePriceChanged`) | £12.99 |

Both verified available through `lib/retailers/shopify-verify.ts` — the same
identity rules used for the Travelling Man recovery: exact product id, exact
stored variant, `available: true`, plausible price.

`www.worldofbooks.com/robots.txt` is standard Shopify: `Allow: /`, and only
`/cart.js`, `/recommendations/products`, admin, cart, checkout and account are
disallowed. `/products/<handle>.js` is permitted.

### Why Wordery is rejected

It has 1,479 shared editions and 1,091 priced rows — nearly nine times the
overlap. It is still rejected.

`scripts/enrich-wordery-prices.ts` works by sending
`Mozilla/5.0 … Chrome/124.0.0.0` and reading the Inertia `data-page` payload.
Probed with the project's own `CatchComics/1.0 (+https://catchcomics.com/bot)`
UA, both requests returned **HTTP 403 with a Cloudflare challenge**. The script
only functions because it misrepresents the client.

That is circumventing an access control, not a technical gap, so it should not
be extended or scheduled. Wordery's robots.txt also opens with "as a condition
of accessing this website, you agree to abide by the following content signals"
and asserts Article 4 EU DSM reservation of rights.

**If Wordery's coverage is wanted, the route is commercial, not technical:**
`AWIN_API_TOKEN` is unset and Wordery is an AWIN merchant. An approved feed
would give all 1,479 editions legitimately. That is a founder conversation.

### Bookshop.org — cheap, but it does not fix comparison

The adapter already supports real prices. `lib/adapters/bookshop.ts`: *"When
`BOOKSHOP_API_KEY` is set, the API is called and real prices are stored. When
no API key, dynamic link stubs are created (price=0.00)."* Stubs are **promoted**
to real prices when the API answers. `BOOKSHOP_API_KEY` is **not set**.

Both Bookshop retailers have 800 active rows, 800 matched to a product, all
£0.00, **last seen today at 04:01** — the hosted `bookshop-refresh` job is
already running and is not sweep-disabled.

So one environment variable would turn 1,600 stubs into real prices with no new
code, no new cron and no revival. It is genuinely the cheapest win available.

But it barely moves the metric that matters:

- active Bookshop stubs on one of the restored ten: **0**
- active Bookshop stubs on any recoverable Travelling Man edition: **31**

Worth doing for catalogue credibility — priced products would go from 10 to
~1,610 — but it is not the comparison fix. **Cost is unverified:** confirm
whether the Bookshop API is free for affiliates before enabling it, per the API
spend guardrails in CLAUDE.md.

---

## The mistake to correct

The Travelling Man recovery ranked candidates by **price descending**. That was
the wrong objective. It restored ten real offers, but it optimised for nothing
that produces comparison — and only 2 of the 10 have a World of Books row at
all.

Selection should rank by **verifiable overlap**: an edition where *both*
retailers can be verified live in the same run. Each such pair moves "products
at 2+ retailers" by one. Ranking by price moves it by zero.

---

## The work

### 1. Pick pairs, not rows

Select editions where a Travelling Man row (27 October cohort) **and** a World
of Books row both exist and carry a stored price — 170 such editions, 168 with
a WoB price. Verify both sides live in one run. Publish only pairs where **both**
sides verify available. A pair where either side is sold out is not a
comparison, so neither side is revived for that edition.

### 2. Per-row deletion scoping, not one global timestamp

Travelling Man's recovery pinned `deleted_at = 2026-10-27T03:00:46.263Z`, one
clean sweep. **World of Books does not have one cohort.** Measured cohorts
include 37,802 (13 Aug), 29,559 (15 Jul), 24,022 (11 Jun), 24,013 (10 Jul),
21,554 (16 Jul) — and the two rows probed above were deleted 2026-07-03, which
is not even in the top five.

So scope each `UPDATE` by `id` **plus the exact `deleted_at` value read for
that row in the same run**. That keeps the "cannot touch an unrelated row"
guarantee without needing a single global cohort.

### 3. Exclude manual suppressions

Travelling Man's 15,922 rows deleted at **14:37** on 13 May are a manual bulk
suppression, not a cron sweep. Before touching World of Books, confirm its
cohort timestamps all fall in the cron window (03:00–04:01 UTC) and **refuse
any row whose `deleted_at` falls outside it**. Any row deleted off-schedule is
presumed deliberate and left alone.

### 4. Reuse, do not rebuild

- `lib/retailers/shopify-verify.ts` already handles World of Books.
- `scripts/price-verify-dryrun.ts` already has a World of Books cohort with
  trust criteria (ComicVine id, CV metadata, or a comic publisher) and
  `WOB_MAX_ROWS = 50`. Do not broaden those criteria.
- `offer_refresh.verified_offers` (shipped in PR #54) **already includes
  `worldofbooks.com`** in `SHOPIFY_VERIFY_DOMAINS`, so once rows are active the
  daily 02:00 refresh keeps them fresh with no further work.
- `offer_health.check` already alarms on coverage falling and on approaching
  expiry, so the new rows are watched from day one.

The only new code is a paired-selection variant of
`scripts/b4-revive-verified-offers.ts`. Its recovery pass constant
(`RECOVERY_DOMAIN`) is currently Travelling Man only — extend deliberately or
leave the revival as a one-off script run.

### 5. Bounds

Mirror the Travelling Man recovery exactly: dry-run default, `--write` to
publish, 1 req/s sequential, retries ≤ 3 with doubling backoff, the 10x price
plausibility guard, a transient-failure circuit breaker, a runtime ceiling, and
no listing or canonical-product creation. Roughly 2 requests per pair, so 40
pairs ≈ 80 requests ≈ 2 minutes. No paid API, no new service.

---

## What to approve

| | |
|---|---|
| **Scope** | Up to **40 edition pairs** (80 rows) revived — Travelling Man + World of Books, both sides verified available in the same run |
| **Writes** | `deleted_at` cleared, price, stock, `lastSeenAt`, one `price_history` observation per row. Nothing created |
| **Not included** | No bulk reactivation of 529,927 World of Books rows, no new paid service, no Wordery, no Amazon, no `scheduled_sync_disabled` changes |
| **Pass condition** | `npm run launch:health` reports **products at 2+ retailers ≥ 30**, and a real product page shows the same edition at two retailers with two different prices and two working outbound links |
| **Separately** | Decide on `BOOKSHOP_API_KEY` (confirm cost first) and `SLACK_WEBHOOK_URL` (alerts currently reach Vercel logs only) |

Expected outcome: **products at 2+ retailers 0 → up to 40**, against a measured
ceiling of 170 for this retailer pair. That is the first genuine price
comparison on the site.

## What this does not solve

Forty pairs is a demo-grade proof, not a price-comparison product. The ceiling
for Travelling Man + World of Books is 170 editions out of a 136,277-product
catalogue. Real breadth needs a legitimate feed with wide overlap — on the
measured numbers that means **Waterstones (1,792 editions) or Wordery (1,479)
via an approved AWIN feed**, not scraping. Worth starting that conversation in
parallel, because it has a lead time and this does not.
