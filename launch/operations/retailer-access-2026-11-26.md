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

## CORRECTION, 2026-11-27 — the hosted schedule is registered, not executing

On 2026-11-26 I reported hosted scheduling as enabled for Waterstones,
Scholastic and Lets Buy Books. **That was registration. It has not executed,
and the cause is outside this repository.**

How it was caught, rather than asserted: Scholastic's `refreshIntervalHours`
was brought forward to 1 at 2026-11-26 23:41 specifically so a hosted run
could be *observed* the same night. At the 01:00 UTC tick the cron's own SQL
and predicate rate it DUE. No `sync_logs` row appeared.

The evidence, from `npm run retailers:diagnose-tick`:

- `sync_logs` holds **0 rows in the last 48 h, for every retailer**. The newest
  row for any of the three feeds is `scholastic.co.uk · running ·
  2026-08-09 10:01`.
- **Two jobs stop dead on 2026-08-09, and only those two:**
  `sync-retailer-scheduled` (last effect 10:01) and
  `price_check.canonical_products` (last run 12:00). The three once-daily crons
  in the same Inngest app ran through to 2026-11-26 — `bookshop.refresh` 04:00,
  `cleanup.stale_listings` 03:00, `enrich.canonical_products` 02:00. The two
  dead ones are exactly the two that enqueue `sync/retailer` events.
- Every historical `sync_logs` row for these retailers is `running`, never
  `success`: the function never reached its final step. That matches the
  2026-08-09 Inngest quota incident which `lib/sync/dispatch.ts` already
  documents as the reason the failure-backoff exists.

Ruled out inside the repository:

| candidate | ruled out by |
|---|---|
| function not served | `syncScheduled` is in the `functions` array of `app/api/inngest/route.ts` |
| Cost Guard refusal | state is AMBER; `sync-retailer-scheduled` declares `estRows`/`estRequests`/`maxRuntimeMs`, which AMBER requires and accepts. Zero active restrictions on any sync operation; the refusal log stops at 2026-08-08 |
| in-flight run lease | the stale `running` rows are from August, far past `RUN_LEASE_MS` (30 min) |
| failure cooldown | 0 attempts postdate the last success, so `failureCooldownMs` is 0 |
| `scheduled_sync_disabled` | false on all three since 2026-11-26 |
| inside refresh interval | the predicate itself returns DUE |

**Inference, stated as one:** the pause is Inngest-side. This machine holds no
`INNGEST_*` credentials, so a function's enabled/paused state cannot be read
from here — it has to be read in the Inngest dashboard. A deliberate pause of
the two sync-driving crons during an August quota incident, never undone, fits
every observation above; nothing in the repository does.

### The 02:00 tick splits this into two separate faults

Watched live at 2026-11-27 02:07. `enrich.canonical_products` (cron `0 2 * * *`)
**ran at 02:00:24**, so the Inngest app is alive and firing crons at that exact
minute. `offer_refresh.verified_offers` — same `0 2 * * *`, registered in
PR #54, merged 2026-11-26 — produced **no `job_runs` row on its first scheduled
fire**. Nor has `offer_health.check`.

The Cost Guard cannot explain that one either: `offer-refresh` is classed
`deferrable` with full `estRows`/`estRequests`/`maxRuntimeMs`, and `deferrable`
runs in AMBER *and* RED. Only LOCKDOWN would stop it, and `lockdownLatched` is
false. Its `job_runs` insert is the step straight after the gate.

So there are two faults, not one:

| fault | functions | shape |
|---|---|---|
| **A — paused** | `sync-retailer-scheduled`, `price-check` | registered long ago, fired hourly/4-hourly until 2026-08-09, then stopped dead while siblings kept running |
| **B — never registered** | `offer-refresh-verified-offers`, `offer-health-check` | added in PR #54 on 2026-11-26, two deploys since, never fired once |

Fault B means **the watchdog and the thing it watches are both dark**:
`offer_health.check` exists precisely to alarm when `offer_refresh` has not
succeeded. Neither runs.

**Prediction, recorded before the fact:** if B is "the Inngest app was never
re-synced after the PR #54 deploy, so new functions are absent from Inngest
Cloud", then at 03:00 `cleanup.stale_listings` (old) fires and at 04:00
`offer_health.check` (new) does not.

**Result, measured 2026-11-27 03:00–04:06 — the prediction holds, and the
tick turned it into a matched-pair test.** Two pre-existing jobs fired on
schedule and two PR #54 jobs did not, at crons that are identical to the
minute:

| cron | pre-existing job | PR #54 job on the same cron |
|---|---|---|
| `0 2 * * *` | `enrich.canonical_products` — ran 02:00:24 | `offer_refresh.verified_offers` — no `job_runs` row, ever |
| `0 4 * * *` | `bookshop.refresh` — ran 04:00:23 (171 → 172) | `offer_health.check` — no `job_runs` row, ever |

`cleanup.stale_listings` (`0 3 * * *`) also ran, at 03:00:15 (199 → 200), and
`price_check.canonical_products` stayed frozen at 2026-08-09 12:00:32 across
all three ticks, so Fault A is unchanged too.

Because each new function shares a cron expression with an old one that fired
within ~25 s of the same minute, this additionally rules out a mistyped cron,
timezone drift, and the app or the `/api/inngest` route being down. Cost Guard
is out on its own evidence: every refusal path in `lib/costguard/gate.ts`
calls `recordRefusal`, which persists to `costguard:events`; that log holds 11
entries, all 2026-08-07/08, and is nowhere near the `MAX_EVENTS` cap, so
nothing was evicted. A November refusal would be there. It is not.

**What this evidence still cannot separate**, and the dashboard can: "absent
from Inngest Cloud" versus "invoked and failing before the `job_runs` insert".
Both new functions write that row after their gate step, so a crash on first
invocation would look identical from the database. It would need both to fail
identically on their first ever run, which is the less likely reading — but it
is a reading, not a ruled-out one, and `on-failure` would have sent it only to
Slack (see W5). So the owner action is unchanged: look for whether these two
function IDs appear in the Inngest app at all. Their presence or absence
settles it in one glance.

**Why nothing shouted.** `on-failure` writes `console.error` and posts to Slack
and persists nothing, `SLACK_WEBHOOK_URL` is unset, and no `VERCEL_*` token
exists on this machine. A function that crashed before its `job_runs` insert
and one that was never invoked are therefore indistinguishable from here. That
is the real cost of the unset webhook: not a missed notification, but a whole
class of silent failure with no local evidence.

**Consequence for the verdict.** Every priced offer on the site carries real,
honestly-dated prices, and nothing refreshes any of them automatically.
`cleanup-stale` (cron `0 3 * * *`) runs both passes against `last_seen_at` at
30 days — pass 1 to `OUT_OF_STOCK`, pass 2 soft-delete — so each offer has a
dated expiry, measured 2026-11-27 01:20:

| retailer | priced rows | first sweep |
|---|---|---|
| Scholastic | 17 | 2026-12-26 00:03 |
| Travelling Man | 49 | 2026-12-26 13:48 |
| World of Books | 40 | 2026-12-26 17:20 |
| Lets Buy Books | 13 | 2026-12-26 19:09 |
| Waterstones | 3,715 | 2026-12-26 19:12 |

So this is not only the Awin feeds. **The 40 pairs that close B4 expire on the
same day**, and their freshness depends on `offer_refresh.verified_offers`
(02:00 UTC, PR #54), which has no `job_runs` row either. The site is sound
today and goes dark on 2026-12-26 unless the Inngest functions resume.

The CLI fallback is uneven, and worth knowing before relying on it:

- **Awin feeds** (Waterstones, Scholastic, Lets Buy Books) — covered:
  `npm run awin:ingest -- <domain> --write` re-reads the feed and re-dates the
  rows it ingests.
- **The 40 pairs** (Travelling Man, World of Books) — **not covered.**
  `b4-revive-paired-offers.ts` verifies an already-active side but
  deliberately never writes it, because its job is reviving swept rows, not
  refreshing live ones. So there is no CLI path to re-date these 89 rows;
  `offer_refresh.verified_offers` is the only mechanism, and it has never run.

`npm run retailers:diagnose-tick` prints the expiry table with live dates.

Scholastic's interval was put back to 24 h at 2026-11-27 01:10, as agreed,
rather than left at 1 h to hide the gap behind frequent retries.

## Still to do

Two of these need the Inngest account and nothing else; the rest are ours.

1. **Fault A — resume the paused crons.** In the Inngest dashboard, confirm
   whether `sync-retailer-scheduled` and `price-check` are paused or disabled,
   and resume them. Everything else on that path is deployed and permitted.
2. **Fault B — re-sync the app so PR #54's functions register.** Check whether
   `offer-refresh-verified-offers` and `offer-health-check` appear in Inngest
   at all. If they do not, the app needs a sync (Inngest's Vercel integration,
   or a manual sync of the production `/api/inngest` URL). Two deploys have
   landed since they were added and neither registered them, so this will not
   fix itself on the next deploy.
3. **Set `SLACK_WEBHOOK_URL`.** Not cosmetic. `on-failure` and
   `offer_health.check` both exist to shout about exactly this, and both are
   currently shouting into Vercel logs that nobody reads. Had it been set, the
   01:00 and 02:00 silences would have arrived as alerts rather than needing a
   deliberate hunt.
4. Once the crons run, prove a second hosted run either consumes a new feed
   build or correctly recognises an unchanged one — the unchanged-feed case is
   already proven on the CLI path (Scholastic re-run: 16 updated, 0 price
   changes, newest observation and newest `last_seen` both unmoved).
5. Give `sync-retailer-scheduled` a `job_runs` row of its own. It is the only
   scheduled job that records nothing, which is why its silence had to be
   inferred from `sync_logs` rather than read directly.
6. Bookshop UK: hold until Awin rebuilds feed 99173 (last built 2026-09-23) or
   `BOOKSHOP_API_KEY` is set.
7. Re-verify eBay through the customer journey and keep it measured separately
   from stored prices.
