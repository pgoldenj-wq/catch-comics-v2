# Claude Fix Prompts — bounded, one group per session

Paste one block per session. Each is scoped, reversible, and respects CLAUDE.md (no commits without approval, no schema/scoring/queryA changes, enrichment job owns canonical_products).

---

## §1 — Copy honesty (LB-1) · ~30 min
> In catch-comics, replace the phrase "The world's only comic price comparison" in `app/page.tsx` (two occurrences: mobile hero ~line 329, desktop hero ~line 475) and "The world's only comic price-comparison service" in `app/about/page.tsx` (~line 19) with: "[FOUNDER-APPROVED LINE]". Copy-only change — do not touch layout, spacing, or any other text (homepage is design-frozen). Run `npm run check`, show me the diff. Do not commit.

## §2 — Search format labels from DB (LB-2) · ~2 h
> In `app/search/page.tsx`: canonical results (source === 'canonical') currently get their format label from `detectFormat()` title heuristics, which mislabels e.g. Absolute Batman single issues as "Hardcover Edition". The API already returns the DB format (mapped to `type: 'issue' | 'volume'`). Add the raw DB format string to the mapped ComicResult, and for canonical results derive the display Format from it (SINGLE_ISSUE→single-issue, TPB→graphic-novel, HARDCOVER/DELUXE/ABSOLUTE→hardcover, OMNIBUS/COMPENDIUM→omnibus, MANGA_VOLUME→manga, OTHER→graphic-novel). Keep heuristics only for CV/OL results. Update `matchesFormat` so pill filtering uses the same source of truth. Verify with `/search?q=absolute batman`: issues #1–#20 must show SINGLE ISSUE and appear under the Single Issues pill. Do not touch `lib/search/` scoring. Show diff; do not commit.

## §3 — Honest price hints (LB-3) · ~2–3 h
> In catch-comics, the search page's `PriceTag` calls `/api/price-hint?q={title}` (title-string eBay search) which produces wrong-product price anchors (e.g. "Absolute Batman Vol. 3" HC showing "From £5.95" for a single issue). Change: (1) `app/api/price-hint/route.ts` accepts an optional `isbn` param and when present queries eBay by ISBN (mirror how `app/api/ebay/route.ts` uses `lib/ebay.searchListings` with ISBN); version the cache key. (2) In `app/search/page.tsx`, pass the result's `isbn13` to PriceTag when present; when absent, render the "Find prices →" state without fetching. Keep the 80ms stagger. Verify: no numeric "From £" on results lacking an ISBN; AB Vol 3 no longer shows a sub-£10 anchor. Show diff; do not commit.

## §4 — Search empty state + sitemap (LB-5) · ~30 min
> In `app/search/page.tsx`: visiting `/search` with no `q` leaves `loading=true` forever (skeletons never resolve — the fetch effect early-returns). When query is empty, skip fetching and render an empty state: "Search for a comic, series or ISBN" with the search bar focused. Also remove the `/search` entry from STATIC_ROUTES in `app/sitemap.ts` (single entry removal only — touch nothing else in the sitemap; it's SEO-critical). Verify `/search` renders the empty state instantly. Show diff; do not commit.

## §5 — Rate limits on metered proxies (LB-6) · ~1–2 h
> In catch-comics, apply `enforceRateLimit` from `lib/security/rateLimit.ts` (same pattern as `app/api/search/route.ts`) to: `app/api/price-hint/route.ts` and `app/api/comic/[id]/route.ts`. Choose envelopes consistent with legitimate browsing: price-hint is called up to ~20×/search-page-load per user; comic/[id] up to ~25×/product-page (issue grid) — set per-IP limits with headroom above that (e.g. 120/min price-hint, 200/min comic) and confirm the existing limiter's window semantics fit. Honour `RATE_LIMIT_DISABLED`. Verify: burst curl → 429; normal page loads unaffected (check dev server logs while browsing a product page). Show diff; do not commit.

## §6 — Homepage rail honesty + curation (LB-7) · ~2–3 h
> In catch-comics homepage: (1) rename "Top deals today" to "[FOUNDER CHOICE: Live prices | Popular this week]" in both mobile and desktop sections of `app/page.tsx` — copy only, no layout changes. (2) In the static fallback TOP_DEALS rendering, remove the strikethrough RRP and "-N%" badge UI (fabricated discounts); keep plain prices labelled "Sample prices". (3) In `app/api/homepage-deals/route.ts`, add a PINNED_SLUGS: string[] constant (founder-provided, ~12 slugs); return pinned products first (same R2-cover + in-stock listing requirements), then fill remaining slots with the existing query, dedup by slug. Do not change the SQL quality gates. Verify: carousel shows pinned cards first with live prices + covers. Show diff; do not commit.

## §7 — Wave-2 product-page polish · ~2 h
> In `app/product/[slug]/page.tsx`: (1) render the Price History section only when `sparkPoints.length >= 2` — remove the permanently-empty module, no other layout changes. (2) Change the "Price Comparison (N listing)" count label to "(N tracked retailer{s})" so it can't contradict the All/New/Used tab counts that include eBay rows. (3) Add a small "Report an issue" mailto link (subject prefilled with the product slug) near the ISBN line. Show diff; do not commit.

## §8 — Wave-2 series-page honesty · ~1–2 h
> In catch-comics series pages: (1) truncate the ComicVine-sourced series description to its first paragraph (before wiki-style sections like "Awards"/"Hiatus") wherever it's rendered (check `SeriesHero` / `getSeriesData`), with the existing "Read more" keeping the full text if already supported — otherwise just truncate. (2) Add a "Series information via ComicVine" attribution line under the description (CV API ToS). (3) In `app/series/page.tsx` hero copy and `app/series/[slug]` metadata description, soften "UK price comparison on every volume" to "compare prices where available". Show diff; do not commit.

## §9 — Wave-2 CV-call waste + cleanup · ~1 h
> In `app/page.tsx`, the static-deal cover effect fires ~10 `/api/comic/{id}` fetches on mount before `/api/homepage-deals` resolves, wasting ComicVine/KV budget on every homepage visit. Restructure so the static-cover fetches start only after the homepage-deals fetch settles AND returned <3 deals. Also delete unused Next.js scaffold assets from `public/` (file.svg, globe.svg, next.svg, vercel.svg, window.svg) after grepping for references. Show diff; do not commit.

## §10 — Flagship publisher data fix (coordinate!) · ~1 h
> READ CLAUDE.md "Active background jobs" first — the CV enrichment job writes to canonical_products and IS RUNNING; check `npm run enrich:catalogue:report`. Write a read-only report script listing live products where `series_name ILIKE 'Absolute %'` AND publisher NOT ILIKE '%DC%' (expected: Absolute Flash "Penguin Random House NZ" and siblings). Show me the rows and a proposed single UPDATE (publisher → 'DC Comics') for explicit approval before ANY write. Row-level data fix only; no schema, no bulk operations.
