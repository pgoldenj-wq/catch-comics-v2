# Launch Blockers — the only list that matters

**Rule used:** a blocker is something that, if a collector or journalist hits it in week one, damages trust in a way that's hard to earn back. Everything else is in the roadmap, not here.

**Total: 8 blockers · est. 2–3 focused days · all reversible, none touch schema or hands-off files except where flagged.**

---

## LB-1 · Remove "The world's only comic price comparison" (overclaim)
- **Where:** `app/page.tsx:329`, `app/page.tsx:475`, `app/about/page.tsx:19`
- **Wrong:** falsifiable superlative; the comparison depth behind it is 1 retailer + eBay for 99.8% of priced products. Already flagged in `docs/brand/` for softening.
- **Fix:** swap to the approved brand line, e.g. "Compare comic, graphic novel & manga prices across UK retailers." Three string edits. *(Note: homepage carries a DESIGN FREEZE comment — this is copy, not layout, but get founder sign-off on wording first.)*
- **Accept:** the phrase appears nowhere in the repo; homepage + About read honestly.

## LB-2 · Search format labels wrong on flagship queries
- **Where:** `app/search/page.tsx` `detectFormat()` (~line 222) + `matchesFormat()`
- **Wrong:** all Absolute Batman single issues labelled "HARDCOVER EDITION" in production. The client guesses from title keywords and ignores the DB `format` the API already returns.
- **Fix:** for `source === 'canonical'` results, map server format (`SINGLE_ISSUE`→Single Issue, `TPB`→Graphic Novel/TPB, `MANGA_VOLUME`→Manga, etc.) and only fall back to heuristics for CV/OL results. Keep filter behaviour consistent with the same mapping.
- **Accept:** prod search "absolute batman" labels #1–#20 as SINGLE ISSUE; volumes stay Hardcover/Absolute; format pills still filter correctly.

## LB-3 · eBay "From £X" price hints anchor the wrong product
- **Where:** `app/search/page.tsx` `PriceTag` → `app/api/price-hint/route.ts`
- **Wrong:** title-string eBay search; observed "Absolute Batman Vol. 3" (~£30 HC, unreleased) showing "From £5.95" (a single issue). Wrong-product price anchors = fake-deal territory.
- **Fix (smallest honest):** when the canonical result has `isbn13`, query price-hint by ISBN; when it doesn't, show "Find prices →" instead of a number. (`lib/ebay.searchListings` already supports ISBN via `/api/ebay` — mirror that in price-hint.)
- **Accept:** no numeric "From £" appears on a result unless keyed by ISBN or the product's own offers.

## LB-4 · Missing `public/og-image.png`
- **Where:** referenced in `app/layout.tsx:39,50`; file absent from `public/`
- **Wrong:** every homepage/social share renders a broken card at exactly launch-buzz moment.
- **Fix:** export a 1200×630 card from the brand kit into `public/og-image.png`.
- **Accept:** opengraph.xyz / Discord paste shows the card.

## LB-5 · `/search` without a query = infinite skeleton (and it's in the sitemap)
- **Where:** `app/search/page.tsx` fetch effect (`if (!query) return`, ~line 524); `app/sitemap.ts` STATIC_ROUTES
- **Wrong:** `setLoading(false)` never runs with an empty query — permanent skeletons for users AND for Googlebot (sitemap lists `/search` bare).
- **Fix:** when `!query`, render an empty-state ("Search for a comic, series or ISBN") and skip the skeleton; drop `/search` from the sitemap.
- **Accept:** visiting `/search` shows the empty state instantly.

## LB-6 · Rate-limit `/api/price-hint` and `/api/comic/[id]`
- **Where:** `app/api/price-hint/route.ts`, `app/api/comic/[id]/route.ts` (limiter exists: `lib/security/rateLimit.ts`, used by 5 other routes)
- **Wrong:** unauthenticated, unratelimited proxies to metered upstreams (eBay daily quota; ComicVine 200/hr that the *enrichment job* also depends on). A dumb crawler can starve both.
- **Fix:** apply `enforceRateLimit` with the same envelope the search route uses. Kill-switch (`RATE_LIMIT_DISABLED`) already exists.
- **Accept:** burst-curl gets 429 after threshold; normal browsing unaffected; smoke test V4 passes.

## LB-7 · Homepage "Top deals today" naming + curation
- **Where:** `app/page.tsx` section header; `app/api/homepage-deals/route.ts` ordering
- **Wrong:** cards are lowest prices ranked by WoB stock depth, not deals — and the live #2 card is adult-adjacent niche manga. First-impression + honesty problem in one.
- **Fix (launch-sized):** rename to "Live prices" / "Popular this week"; drop the fabricated "-N%" strikethroughs from the static fallback; add a pinned-slugs curation list (12 crowd-pleaser series with R2 covers + live prices) that fills first, algorithmic fill after.
- **Accept:** section title doesn't say "deals" unless a real reference price exists; founder approves the 12 pinned cards.

## LB-8 · Amazon UK rows go stale on launch day — ✅ CLOSED 2026-07-13
- **Decision:** Rainforest retired entirely (founder; account closed). Option (b) chosen and hardened: stale Amazon rows are *hidden* (not greyed) by the product-page filter and soft-deleted by the daily cleanup — no wall of grey rows is possible.
- **Now:** Amazon is AFFILIATE-ONLY / STORED OFFERS. Coverage declines honestly as rows expire (all by 26 Jul). Launch health + Mission Control show this as an informational state.
- **Future:** Amazon Creators API when eligible (10 qualifying sales/30d) — see `launch/operations/amazon-post-rainforest-plan.md`.
- **Accept (met):** on 26 Jul, no page shows a wall of greyed Amazon rows.

---

## Explicitly NOT blockers (resist the urge)
- 64% missing covers / 68% missing descriptions — handled honestly by fallbacks; fixing is a months-long pipeline, not a launch task.
- Single-retailer comparison depth — fix the *copy* (LB-1), then add retailer #2 post-launch (highest-leverage data work; see roadmap Wave 4).
- Creators/format enrichment for the 88% un-matched catalogue — the job is running; it keeps running.
- Price History emptiness, "(1 listing)" count mismatch, series CV-wiki text, sitemap thin-page gating — Wave 2 (should-fix, not must-fix).
