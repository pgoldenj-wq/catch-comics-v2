# Catch Comics — Product Excellence Audit

**Date:** 2026-07-12 · **Auditor:** Claude (Fable 5) · **Branch:** `main` @ `da0b510`
**Method:** full code read of every product surface, read-only DB stats (`scripts/audit-launch-readiness-stats.ts`), live production checks (catchcomics.com), local dev-server pass.

**Overall verdict: NEARLY READY.** The engineering under the trust surfaces is genuinely good — honest empty states, stale-price greying, placeholder-proof covers, commission-blind price sort, real `<a>` rows, solid JSON-LD. What stands between this and a credible launch is mostly **copy that overclaims what the data can back**, a handful of **wrong-label bugs visible on the flagship search**, and **unratelimited API routes that can burn quota**. Nearly all of it is 1–3 days of bounded work.

---

## Hard numbers (DB, 2026-07-12)

| Metric | Value | Read |
|---|---|---|
| Live products | 81,832 | Big catalogue, ISBN-backed (99.9% have ISBN-13) |
| Format known (not OTHER) | 11,645 (14.2%) | 85.8% show generic "Comic" label — honest fallback, thin metadata |
| Cover: R2 (validated) | 24,556 (30.0%) | `none` = 52,469 (64%). Homepage/series gate on R2 — good |
| CV-matched | 9,898 (12.1%) | Enrichment running; ~21 days left → **won't finish by 26 Jul launch** |
| Creators stored | 9,025 (11.0%) | Missing on flagships too (AB Vol 2 has none in prod) |
| Descriptions | 26,542 (32.4%) | Flagship AB Vol 2: "No description available." |
| Active priced listings | 48,805 | Fresh: 8,654 <7d · 39,248 7–30d · only 903 >30d. **Freshness is good.** |
| Products with a priced listing | 37,748 (46%) | |
| **Products with 2+ priced retailers** | **90 (0.24% of priced)** | **The "comparison" is 1 retailer + eBay almost everywhere.** WoB = 87.5% of listings |
| Dynamic-link stubs (no price) | 204,443 | Shown honestly as "More retailers — no live price" |
| Price-history depth | 427k rows / 400k listings ≈ 1 point each | Sparkline is empty on ~every page |
| cv_match_suspect flagged | 4 (values are free text, not boolean) | No systematic wrong-match detection |
| Retailers with priced listings | WoB 42,703 · Lets Buy Books 3,473 · Travelling Man 2,308 · Amazon UK 321 (last sync 26 Jun) | Wordery/Bookshop/Waterstones/eBay-UK etc. = **0** |

---

## 1. Homepage (`app/page.tsx`)

**Good:** coherent dark hero, live deals API well-guarded (R2 covers only, comics-publisher gate, series dedup), reduced-motion respected, arrows + aria-labels, honest "Sample prices" label on fallback.

**Issues:**
- **"The world's only comic price comparison"** (lines 329, 475; also `app/about/page.tsx:19`). Falsifiable overclaim, already flagged for softening in `docs/brand/`. Kills credibility with exactly the collector audience the product courts. → TRUST BLOCKER.
- **"Top deals today" are not deals** — they are lowest prices, ranked by listing count (≈ WoB stock depth). Result observed live: #2 homepage card is *"Asumi-chan is Interested in Lesbian Brothels! Vol. 6"*. Nothing wrong with stocking it; leading the storefront with it is a curation failure at the Apple/Google bar. → rename section + curation gate.
- **Static fallback deals** carry invented RRPs and "-25%" strikethroughs. Labelled "Sample prices", but fabricated discounts are still fabricated. Drop the discount UI from fallback.
- **Wasted CV calls:** the static-cover effect fires up to 10 `/api/comic/{id}` fetches on every homepage load *before* `/api/homepage-deals` resolves (observed 20 in dev StrictMode). Gate it on live-deals failure instead.
- Hero covers hotlink `comicvine.gamespot.com` directly (lines 174–176) — third-party dependency on the first paint of the site.
- 16 ms `setInterval` carousel drift — constant main-thread work; fine for launch, candidate for CSS animation later.

## 2. Search (`app/search/page.tsx` + `lib/search/*`)

**Good:** unified DB-first results, weak-match honesty banner, "did you mean" gated to low result counts, keyboard-accessible rows, skeletons, URL-held filter state, letter fallback never shows placeholder graphics. Live prod check: 48/49 "absolute batman" results render real R2 covers; ranking puts AB Vol 2 first.

**Issues (all confirmed in production):**
- **Wrong format labels on flagship results.** Every Absolute Batman *single issue* is labelled "HARDCOVER EDITION". `detectFormat()` (line ~222) keys off title keywords ("absolute" → hardcover) and **ignores the DB `format` the API already returns** (`type: 'issue'` is right there in the mapped result). One-line-class fix: trust the server format for `source === 'canonical'`. → TRUST BLOCKER.
- **eBay "From £X" hints mislead.** `PriceTag` queries `/api/price-hint?q={title}` — a title-string eBay search. Observed: "Absolute Batman Vol. 3" (unreleased ~£30 HC) shows "From £5.95" (that's issue #3). A price anchor for the wrong product is a fake-deal-adjacent trust failure. → TRUST BLOCKER (suppress or ISBN-key it).
- **`/search` with no query loads skeletons forever** — `if (!query) return` means `setLoading(false)` never runs (line ~524). And `/search` is in the sitemap, so crawlers index a permanent skeleton. → 15-min fix.
- Near-duplicate rows (two Vol. 1s / two Vol. 3s, sibling ISBNs) with no edition differentiator.
- Wrong publisher visible: "Absolute Flash Volume 1 — PENGUIN RANDOM HOUSE NZ" (distributor stored as publisher; known cv_match backlog).
- Dev-only: search page hydration stalled in local Turbopack session (prod fine) — worth one eye during launch-week deploys.

## 3. Series index + series pages (`app/series/*`)

**Good:** registry-driven (17 curated series), ISR, BookSeries + ItemList JSON-LD, honest "START HERE / Vol. 1" guidance, breadcrumbs.

**Issues:**
- **Promise vs reality:** copy says "UK price comparison on every volume"; live Saga page shows a price on **1 of 12 volumes** (rest "Check price →"). Soften copy or backfill prices for the 17 registry series first.
- **Raw ComicVine wiki text as series description** — Saga page opens with the "graphic robot sex" quote, wiki headers (Awards/Hiatus), broken quote dashes. Also a ComicVine **attribution requirement** and duplicate-content issue. Truncate to first paragraph + add "Source: ComicVine" line.

## 4. Product pages (`app/product/[slug]/page.tsx`)

**Good:** this is the strongest surface. Fresh/in-stock/non-stale gating on the hero price (T1-A), stale rows greyed with "Checked Nd ago", stock display deliberately removed after the OOS-accuracy incident (right call, documented), dynamic links honestly labelled "No live price", "Collected in", prev/next issue nav, Book + AggregateOffer + per-retailer Offer JSON-LD with escaping (`lib/security/jsonLd`), ISR 1h, real `<a>` offer rows with `rel="sponsored"`.

**Issues:**
- "Price Comparison **(1 listing)**" heading beside tabs saying "All **(9)**" (SSR count vs SSR+eBay count). Confusing arithmetic on the page's core module.
- **Price History module says "not enough data" on effectively every page** (~1 history point per listing). An always-empty module reads as a broken product. Hide until ≥2 points exist.
- Creators row absent on AB **Vol 2** (CC-016 backfill covered Vol 1 only). Missing ≠ wrong, but flagship pages should have the core team.
- Issues grid hotlinks 22 `comicvine.gamespot.com` images per page; all returned naturalWidth 0 in my session. Unconfirmed for real users — **founder should eyeball on phone + desktop**; the onError fallback tiles (#N) are acceptable if hotlinks die.
- No description on flagships (AB Vol 2). Backlog CV synopsis backfill for top series.

## 5. Offers / retailer flows (`components/OffersTable.tsx`, `app/go/[id]/route.ts`)

**Good:** commission-blind price sort, best-price badge only on tracked retailers, eBay rows visibly branded with postage caveat + commission disclosure, stale rows at 50% opacity, `/go` validates UUID, soft-deletes 404, logs clicks via `after()`, affiliate wrap with clickref. This layer is launch-grade.

**Issues:** none blocking. Amazon UK's 321 listings were last synced 26 Jun — they cross the 30-day stale line **around launch day (26 Jul)** and will all grey out simultaneously. Decide: one manual resync, or soft-hide Amazon rows.

## 6. Cover/image system

**Good:** single shared filter (`lib/images/url-filters`) across homepage/search/product/series; placeholder detection by URL + naturalWidth≤1 trick; R2-only gate for homepage; next/image only for allowlisted hosts (the war-room crash lesson is encoded); content-hash placeholder purge already done (Cover Zero).

**Issues:** 64% of catalogue coverless (honest letter/book fallbacks — acceptable); CV/OL hotlink dependence for live fallbacks (OL hotlinks ×3,485 known backlog); wrong-cover risk is low given verified R2 pipeline.

## 7. Trust & data confidence

See `trust-and-data-quality-review.md`. Verdict: **MOSTLY TRUSTWORTHY WITH KNOWN GAPS — provided the overclaim copy and wrong-label bugs are fixed before launch.** The data rarely lies; the copy sometimes does.

## 8. Performance

- Product/series pages: ISR 1h/15m, server-rendered — good.
- Homepage + search are fully client-side (`'use client'`): data fetched post-hydration, deals/results pop in. Acceptable for launch; SSR-ing search results is the biggest post-launch CWV lever.
- Search fires up to ~20 staggered `/api/price-hint` calls per query (each a potential eBay call on cold instances) + `/api/ebay` per product page. In-memory TTL caches don't survive serverless cold starts.
- 22 hotlinked CV images per product page.

## 9. Accessibility

Genuinely decent: aria-labels on icon buttons, `aria-pressed` on pills, `aria-expanded` on filter sections, real links for offer rows, keyboard handlers + `role="link"` on result cards, reduced-motion honoured (hero sway, carousel, publisher strip), labelled sort select, breadcrumb `nav`. No blockers found. Nits: PriceTag shimmer has no `aria-live`; flag-only region buttons on mobile rely on emoji + text (OK).

## 10. Mobile

Separate mobile JSX trees (homepage), MobileHeader, filter drawer, 2-col deal grid, 36px tap targets, format pills. Code-level review clean; **founder should do one physical-device pass** (pane screenshots unavailable this session).

## 11. SEO / shareability

- **`/og-image.png` is referenced in `app/layout.tsx` but does not exist in `public/`** → every social share of the homepage has a broken card image. → LAUNCH BLOCKER (30-min fix).
- Sitemap lists **all 81,832 products**; 64% coverless, 68% description-less, ~54% offer-less → mass thin-content indexing at launch. Recommend gating sitemap to products with a cover AND (priced offer OR description) — one WHERE clause.
- `/search` in sitemap indexes a permanent skeleton (see §2).
- JSON-LD across product/series/index is well done. Canonicals, robots, metadata template all correct.
- CV wiki text duplication (series pages) — attribution + dedupe (§3).

## 12. Security / cost

Phase 2 hardening (headers, CSP-RO, KV rate limiter on search/autocomplete/ebay/log-error/csp-report, JSON-LD escaping, eBay error sanitisation) is real and shipped. Gaps:
- **`/api/price-hint` has NO rate limit** and only per-instance cache → direct hammering burns the eBay daily quota. → COST BLOCKER.
- **`/api/comic/[id]` has NO rate limit** — KV-cached, but uncached-ID enumeration drains the 200/hr ComicVine budget that the enrichment job depends on.
- `/api/prices`, `/api/series-preview` unratelimited (cheap, DB-only — lower priority).
- Founder toggles still open: Vercel Spend Management cap, GitHub secret scanning + Dependabot.

## 13. Brand / visual credibility

Coherent and above-average: consistent dark-hero identity, editorial layout, covers given room, no generic-SaaS feel. The brand risk is **verbal** (overclaims), not visual. Leftover Next.js scaffold SVGs in `public/` (file.svg, globe.svg, etc.) — delete for tidiness.

## 14. Founder operations

Mission Control (launch date 26 Jul, honest readiness math), Smoke Test V4 with evidence capture, marketing dashboard, security docs — unusually good founder tooling. Gaps: no single launch-day runbook; no scheduled data-health check (coverage/suspect/stale counts over time — the new `scripts/audit-launch-readiness-stats.ts` can be that check).

---

*Companion docs: `launch-blockers.md` · `trust-and-data-quality-review.md` · `apple-google-quality-bar.md` · `productisation-plan.md` · `implementation-roadmap.md` · `founder-action-list.md` · `claude-fix-prompts.md` · `verification-checklist.md` · `mission-control-input.json`*
