# Productisation Plan — from working website to real product

## 1. Product promise

**Promise at launch (can be backed today):**
> "Search any comic, graphic novel or manga. See live UK prices — tracked retailers plus eBay — with honest freshness labels, and links straight to the store."

**Do NOT promise yet:**
- "World's only / every price / every retailer" (superlatives — LB-1)
- "Deals" (no reference-price logic exists)
- "Price comparison on every volume" (series pages — 1/12 Saga vols has a price)
- Community, collections, alerts (don't tease what doesn't exist)

The wedge is still price — but the honest wedge sentence is "*stop opening six tabs to price a comic*", not "*we index the world*".

## 2. Core user journeys — state and gap

| Journey | State | Gap to close |
|---|---|---|
| Search a comic | Works, fast enough, honest weak-match banner | Format labels (LB-2), duplicate editions unlabelled |
| Compare prices | Offers table launch-grade | Depth = 1 retailer + eBay; fix copy now, add retailer #2 post-launch |
| Check a product page | Strongest surface | Empty Price History module; count mismatch; flagship creators/description gaps |
| Browse a series | 17 curated series, good structure | Overclaiming copy; raw CV wiki text; price coverage on registry series |
| Discover a new read | Homepage rails + Explore Series | Curation gate on "Top deals" (LB-7) |
| Click out to retailer | /go correct, disclosed, tracked | None |
| Understand affiliate model | Footer + dedicated page + eBay footnote | None |
| **Report wrong data** | **Does not exist** | Add "Report an issue" mailto link on product pages (5-line change) — the trust flywheel needs an intake |

## 3. Trust architecture (how the product proves it's honest)

Already built and should be *talked about*: freshness labels ("Checked 4d ago"), stale greying, commission-blind sort, no-stock-claims policy, honest empty states, verified-cover-only homepage.

To add:
- **Report-an-issue link** on every product page (intake).
- **Data-freshness line** in the footer or About: "Prices refreshed daily from retailer feeds; last full sync shown per listing."
- **Suspect-data rule:** products with `cv_match_suspect` never display CV creators/synopsis until re-matched (query-level exclusion).
- **Attribution:** "Series info via ComicVine" where CV text is shown (also a ToS requirement).

## 4. Data architecture review

- **Identity:** ISBN-13 spine (99.9%) — strong. CV enrichment adds richness at 12.1% and climbing (~200/hr cap; won't finish before launch — that's fine, fallbacks are honest).
- **Highest-value automated checks** (weekly, all read-only, seed script exists — `scripts/audit-launch-readiness-stats.ts`):
  1. Comparison depth (products with 2+ retailers) — the promise metric
  2. Stale-listing % (>30d) and per-retailer last-sync
  3. R2-cover coverage % + any non-allowlisted cover hosts appearing
  4. `cv_match_suspect` count + rows displaying CV data while suspect
  5. Products in sitemap failing the quality gate
- **Manual founder checks (keep):** flagship-page eyeball (AB, Saga, One Piece) after each deploy — Smoke Test V4 already does this; add "issue-grid covers render" to its checklist.

## 5. Launch page readiness

| Page | Status | Before launch |
|---|---|---|
| Homepage | Needs copy + curation (LB-1, LB-7) + og-image (LB-4) | Yes |
| Search | Needs LB-2, LB-3, LB-5 | Yes |
| Product | Ready after Wave-2 polish (count, Price History hide) | Polish optional |
| Series | Soften promise line, truncate CV text + attribution | Should |
| Offers/go | Ready | — |
| About/Privacy/Terms/Affiliate | Present and substantive; remove "world's only" from About | Yes (one line) |

## 6. Operational readiness

Exists: Mission Control (honest readiness), Smoke Test V4 (evidence capture), security docs, rollback tag, KV rate limiter with kill switch.
To add: **launch-day runbook** (one page: deploy checklist → smoke pass → dashboards to watch → who/what/rollback), Vercel spend cap ON, GitHub secret-scanning + Dependabot ON, weekly data-health run.

## 7. Post-launch feedback loop

1. **Intake:** Report-an-issue mailto (launch) → structured form (later).
2. **Triage:** founder reviews weekly; wrong-data reports become `cv_match_suspect` entries (standardised shape).
3. **Fix:** suspect rows auto-hide CV-derived display data until re-matched; re-match queue is the existing enrichment tooling.
4. **Compound:** every confirmed wrong-match becomes a rule in the matcher gates (R1/R2 already exist — extend), so the same class of error can't recur. Track "reports per 1k sessions" in Mission Control as the trust KPI.
