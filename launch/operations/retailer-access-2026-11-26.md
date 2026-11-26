# Retailer access — what we actually have

**Measured 2026-11-26, read-only.** Working table, updated as the work proceeds.
Reproduce with `npm run retailers:access`, `npm run awin:entitlements`,
`npm run awin:probe`. No secrets are printed by any of them.

---

## Headline correction

Earlier today I wrote, in `second-retailer-feed-plan-2026-11-26.md` and in
commit `4bf3fd0`, that a legitimate Waterstones or Wordery feed was blocked
because **`AWIN_API_TOKEN` is unset**, and called it "a commercial decision with
a lead time".

**That was wrong.** `AWIN_API_TOKEN` is referenced in exactly one file in this
repo — `scripts/b4-scope-second-feed.ts:38`, which I wrote earlier today. No
adapter uses it. The credential the Awin feed adapter actually reads is
**`AWIN_DATAFEED_KEY`**, and it is **set**.

The publisher account has **578 joined Awin feeds**, including Waterstones with
**153,576 products, re-imported by Awin today at 13:15 UTC**. The entitlement
was there the whole time. I checked a variable name instead of the connection.

---

## Price sources, by whether a price can actually arrive

| Retailer | Platform | Access | Proven today | Live priced rows | Where it stops |
|---|---|---|---|---|---|
| **Travelling Man** | SHOPIFY | Direct `/products/*.js` | yes | **49** | nothing — working |
| **World of Books** | SHOPIFY | Direct `/products/*.js` | yes | **40** | nothing — working |
| **eBay UK** | EBAY | Browse API, creds set | not yet re-verified | live-on-request, not stored | unverified this session |
| **Waterstones** | DIRECT_AFFILIATE | **Awin feed 3787, joined** | **yes — 400 rows, 100% ISBN, GBP** | 0 | **ingestion**: platform is DIRECT_AFFILIATE (adapter refuses) and no `feed_id` in sync_config |
| **Bookshop.org UK** | DYNAMIC_LINK | **Awin feed 99173, joined** | **yes — 400 rows, 100% ident, GBP** | 0 (800 £0.00 stubs) | **ingestion**: platform is DYNAMIC_LINK and no `feed_id` |
| **Lets Buy Books** | AWIN_FEED | **Awin feed 112530, joined** | **yes — 400 rows, GBP, stock flags** | 0 | **scheduling**: configured correctly but `scheduled_sync_disabled=true`; last sync 2026-07-16 |
| **Scholastic** | AWIN_FEED | **Awin feed 2957, joined** | **yes — 400 rows, 100% ISBN** | 0 | **ingestion**: no `feed_id` in sync_config; also sweep-disabled |
| Amazon UK | EXTERNAL_API | Affiliate only; Creators API ineligible | n/a | 0 | **source access** — Amazon-side gate, see `amazon-post-rainforest-plan.md` |
| Wordery | DYNAMIC_LINK | **No Awin feed** (searched by name) | no | 0 | **source access** — not an entitled merchant |
| WHSmith, Forbidden Planet, Zavvi, AbeBooks | DIRECT_AFFILIATE | **No Awin feed** | no | 0 | **source access** — affiliate links only, no price route |

Also joined but not a retailer we model: **Amazon Sellers Programme (UK)**,
feeds 110672 / 110739 (12,090 and 9,867 products). That is marketplace sellers,
not Amazon retail — worth a look later, not a substitute for Amazon UK.

**Searched and genuinely absent from the publisher's 578 feeds:** Wordery,
WHSmith, Blackwell's, Foyles, Forbidden Planet, Zavvi, AbeBooks, World of
Books, Travelling Man, Hive, Book Depository, Speedyhen, Awesome Books.

---

## Why nothing refreshes itself

Two independent gates, and between them they cover every retailer:

1. **`SKIP_PLATFORMS`** in the hourly `sync-retailer-scheduled` job excludes
   `EBAY`, `MANUAL`, `DIRECT_AFFILIATE`, `CJ_FEED` and `DYNAMIC_LINK`. That is
   every retailer except the two Shopify ones and the two `AWIN_FEED` ones.
2. **`scheduled_sync_disabled=true`** in `sync_config` covers the rest:
   Travelling Man, World of Books, Lets Buy Books, Scholastic, Amazon.

So the intersection is empty: **no retailer is on an automatic ingestion path
at all.** The only things writing prices today are the brand-new
`offer_refresh.verified_offers` (02:00, Travelling Man + World of Books, 50 per
retailer per run) and `bookshop.refresh`, which refreshes £0.00 link stubs.

`sync_logs` corroborates it — every retailer except Travelling Man has a most
recent sync stuck in status `running`, from June to August, with 0 listings
touched. Travelling Man's last `success` was 2026-08-18.

`price_check.canonical_products` is registered on `0 */4 * * *` but its last run
of any kind was **2026-08-09**, items 1. Registered, not running.

---

## Defect found while reading the adapter

`lib/adapters/awin-feed.ts:444` pushes the full feed URL into the sync error
record as `context`, and that URL embeds `AWIN_DATAFEED_KEY`. Any fetch failure
therefore writes the live datafeed key into the error trail. Needs redaction
before the feed work goes near production.

---

## Measured overlap — each feed streamed once

| Feed | rows | distinct priced ISBNs | catalogue matches | comic-eligible | in stock |
|---|---|---|---|---|---|
| Waterstones 3787 | 153,995 | 147,509 | 9,572 | **3,715** | 3,715 |
| Bookshop UK 99173 | 23,080 | 22,840 | 1,305 | **262** | 262 |
| Scholastic 2957 | 7,105 | 7,105 | 222 | **16** | 15 |
| Lets Buy Books 112530 | 6,295 | 6,246 | 2,798 | **13** | 11 |

Lets Buy Books is the instructive one: 2,798 of its ISBNs match our catalogue,
but only 13 are comic-eligible. The catalogue still holds general books from
earlier ingests, which is exactly why the gate is "comic-eligible match", not
"any match".

## Ingested 2026-11-26

| Retailer | read | ingested | skipped | created | revived | price changes | errors |
|---|---|---|---|---|---|---|---|
| Waterstones | 153,995 | **3,715** | 150,280 | 258 | 3,457 | 186 | 0 |
| Scholastic | 7,105 | **16** | 7,089 | 16 | 0 | 0 | 0 |
| Lets Buy Books | 6,295 | **13** | 6,282 | 4 | 9 | 4 | 0 |

Comparison depth went **40 products at 2+ retailers → 58** (43 at exactly two,
15 at three or more). The gain is small relative to 3,744 new offers because
Waterstones overlaps the Travelling Man / World of Books set barely at all —
those two carry 89 offers between them.

## Affiliate ids — resolved, not guessed

`sync_config` on Waterstones carried `awinMerchantId_BROKEN: 2079` and
`awinMerchantId_CORRECT: "CHECK_AWIN_DASHBOARD"`, and `affiliate_id` was 3787,
which looks like the feed id in the merchant field. It is not an error: the
feed's own deep link is `awin1.com/pclick.php?p=…&a=2888331&m=3787`, and the
datafeed index gives Waterstones advertiser id 3787. Advertiser and feed id
coincide for older Awin merchants.

| Retailer | advertiser id | stored `affiliate_id` |
|---|---|---|
| Waterstones | 3787 | 3787 ✓ |
| Scholastic | 2957 | 2957 ✓ |
| Lets Buy Books | 122824 | 122824 ✓ |
| Bookshop UK | 62675 | 62675 ✓ |

The placeholder keys are replaced with `awinMerchantId_VERIFIED`.

## Adapter changes, and the hazard each closes

1. **`comic_filter`** — ingest only ISBNs already present as comic-eligible
   catalogue editions. Without it one Waterstones sync creates ~150,000
   general-book listings.
2. **Honest observation time** — `lastSeenAt` and `recordedAt` use the feed's
   Awin *build* time, looked up by the adapter itself. Re-reading an unchanged
   feed cannot give old prices a new date. `dispatchSync` calls
   `syncFeed(retailerId)` with no options, so a caller-supplied value would
   have been inert on the hosted path.
3. **Freshness gate** — refuse a feed Awin built more than 7 days ago.
4. **Conditional revival** — the update path set `deletedAt: null`
   unconditionally, making every sync a blanket undelete. Now only deletions
   inside the 03:00–04:01 UTC cron window are reversible. All 17,629
   Waterstones deletions are automated, so this currently protects nothing
   there; it exists so a deliberate suppression is honoured.
5. **Key redaction** — by URL shape, so per-retailer `api_key` values are
   covered too.

## Credential exposure — scanned, none found

Searched `sync_logs`, `job_runs` (summary and metadata),
`retailer_listings.retailer_url` and `retailers.sync_config` for the exact key
(bound as a SQL parameter) and separately for the `/apikey/<value>` URL shape.
Clean on every one, across 202 error-status Awin syncs. `context` was never
persisted — both writers build `error_summary` from `[type] message` only.
**No rotation required.**

## Scheduling is held until the deploy

Enabling `scheduled_sync_disabled=false` takes effect immediately, because the
hourly scheduler reads retailers from the database and runs whatever adapter
is deployed. The hardened adapter is not deployed yet, so all four feeds are
held. Enable after the deploy, not before.

## Still to do

1. Deploy, then enable hosted scheduling for the three live feeds.
2. Prove a second hosted run either consumes a new feed build or correctly
   recognises an unchanged one.
3. Bookshop UK: hold until Awin rebuilds feed 99173 (last built 2026-09-23) or
   `BOOKSHOP_API_KEY` is set.
4. Re-verify eBay through the customer journey and keep it measured separately
   from stored prices.
