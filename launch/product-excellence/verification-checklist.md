# Verification Checklist — after fixes, before launch

Run top to bottom on **production** after Wave 1 deploys. Anything failing = stop, fix, re-run. (Add the marked items to Smoke Test V4 so they persist.)

## Copy & claims
- [ ] `grep -ri "world's only" app/ components/` returns nothing; homepage + /about read the approved line
- [ ] Homepage rail is not titled "deals" unless a reference price exists; no "-N%" badges on sample data
- [ ] /series copy says "where available", not "every volume"

## Search (flagship query: `absolute batman`, UK) ★V4
- [ ] Issues #1–#20 labelled SINGLE ISSUE; volumes labelled Hardcover/Absolute
- [ ] "Single Issues" pill shows the issues; "Graphic Novels" pill shows the volumes
- [ ] No numeric "From £" on any result without an ISBN; AB Vol 3 shows no sub-£10 anchor
- [ ] 45+ results render real covers (spot-check 5 open the right product)
- [ ] `/search` (no query) renders empty state instantly — no skeletons
- [ ] Weak query (e.g. `zzzz batman`) shows the honest weak-match banner

## Product page (AB Vol 2 + one manga + one coverless product) ★V4
- [ ] Hero cover renders (R2); coverless product shows designed placeholder, no broken image
- [ ] Offers sorted by price; best-price badge on cheapest tracked row; eBay rows badged with postage caveat
- [ ] No stale-grey Amazon wall (LB-8 decision applied)
- [ ] Price History section absent when <2 points (not an empty box)
- [ ] Listing-count label no longer contradicts tab counts
- [ ] Issue-grid covers render on real phone + desktop (ComicVine hotlink check) ★V4
- [ ] Report-an-issue link opens prefilled mail (if Wave 2 landed)
- [ ] `/go/{listingId}` 302s to retailer with AWIN wrap; invalid UUID → 400; JSON-LD validates (Rich Results test)

## Homepage ★V4
- [ ] Pinned cards first, all with covers + live prices; founder-approved set
- [ ] Kill homepage-deals (devtools offline sim): fallback shows sample prices without discount badges
- [ ] Share homepage URL in Discord/opengraph.xyz → og-image card renders

## Cost & security
- [ ] Burst 150 requests at `/api/price-hint` → 429s appear; same for `/api/comic/123`
- [ ] Normal product-page browse produces zero 429s in logs
- [ ] Vercel Spend Management ON; GitHub secret scanning + Dependabot ON
- [ ] `RATE_LIMIT_DISABLED` kill switch documented in security notes still works (staging test)

## Data health (run `npx dotenv-cli -e .env.local -- npx tsx scripts/audit-launch-readiness-stats.ts`)
- [ ] stale_30d_plus not growing week-over-week; WoB lastSeen = today
- [ ] cv_match_suspect rows are not displaying CV creators/synopsis (spot-check the 4)
- [ ] Record comparison-depth + cover-coverage numbers into Mission Control for trend

## Mobile (physical device)
- [ ] Homepage hero, search drawer filters, product page, series page — no horizontal overflow, tap targets OK, cookie notice dismissible and non-dominating
