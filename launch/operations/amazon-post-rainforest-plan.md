# Amazon Post-Rainforest Plan — Catch Comics

**Status:** ACTIVE (canonical Amazon strategy) · **Adopted:** 2026-07-13 (founder decision)
**Supersedes:** the pre-retirement operating plan (never committed) and blocker LB-8.

## 1. What happened

Rainforest was **deliberately retired** on 2026-07-13. The account is closed and the
API key deleted everywhere. All Rainforest code — the HTTP client/adapter, the
product-page on-demand lookup, the bulk and overnight enrichment scripts — has been
removed from the codebase. Do not restore it, generate a new key, or buy credits.

## 2. Current Amazon posture: AFFILIATE-ONLY / STORED OFFERS

- Existing **fresh** stored Amazon offers remain visible on product pages.
- **Stale** offers (>30 days since last observation) are automatically hidden by the
  product-page filter and soft-deleted by the daily cleanup job. They expire honestly;
  freshness timestamps are never faked or extended.
- **Affiliate links stay live**: `/go/{listingId}` wraps stored Amazon URLs with the UK
  Associates tag `catchcomics-21` at click time; PricingPanel "search on Amazon"
  fallback links stay tagged via `NEXT_PUBLIC_AMAZON_UK_ASSOCIATE_TAG`.
- **No live Amazon price API is configured.** `npm run enrich:amazon` refuses with an
  explanation. `npm run amazon:status` is the read-only coverage report.
- Expected trajectory: the ~321 stored priced offers all cross the 30-day line by
  **2026-07-26** and disappear. Amazon coverage → 0 priced offers. **This is
  intentional and honest.** (~78% of those rows sat on non-comic catalogue pollution;
  their expiry is a trust improvement.)

## 3. Amazon remains strategically important

Price-first positioning ("every comic, every price") eventually needs Amazon. The wedge
is: affiliate links earn qualifying sales → sales unlock the compliant API → real price
coverage returns, comics-only, properly matched.

## 4. Preferred future route (in order)

1. **Amazon Creators API** (official, free; replaced PA-API 5.0 in May 2026).
   Eligibility: **~10 qualifying sales in the trailing 30 days** on the Associates
   account; access suspends if sales drop below and auto-restores on recovery.
   Pricing/availability data requires the licence granted with eligibility.
2. **Awin "Amazon Sellers Programme UK" feed** — already JOINED with a product feed
   (RETAILER_OPS item 10). Investigate quality; only adopt if compliant and accurate.
3. **Never:** scraping Amazon; new paid proxy/scraping APIs (Rainforest-class) without
   explicit founder review and written approval.

## 5. Milestones to track (weekly, in Associates Central)

- Qualifying sales in trailing 30 days (target ≥10, sustained).
- Associates account in good standing (UK tag `catchcomics-21`).
- US: no valid tag exists — US links stay untagged until a real US tag is obtained.

## 6. Reintroduction standard (whatever the source)

A replacement integration must meet the bar the old data failed:
- **Identity-safe matching**: ISBN/ASIN-anchored (no title-search matching); verify the
  returned edition against stored ISBN-13; comics-only gate (known format, ComicVine
  match, or trusted-retailer history) so catalogue pollution never gets Amazon prices.
- **Condition honesty**: record new vs used as returned, never hardcode NEW.
- **Freshness rules unchanged**: fresh displays, >30d hidden, failures never bump
  `last_seen_at`, fallback is always omission.
- **Cost/quota guardrails**: per-run caps, hard stops, usage logged to `api_usage_log`.
- **Rollout**: dry-run first, small batch, verify on product pages before scaling.
- Founder approval before the first live call.

## 7. What Mission Control / launch health show meanwhile

> **Amazon: AFFILIATE-ONLY / STORED OFFERS** · X visible / Y suppressed · no live
> refresh, no paid Amazon API (Rainforest retired 13 Jul).
> No action required now. Amazon data coverage will decline as stored listings expire.
> This is intentional and honest until a compliant replacement is approved.

This is an **informational** state — never a failure, never a red alert.
