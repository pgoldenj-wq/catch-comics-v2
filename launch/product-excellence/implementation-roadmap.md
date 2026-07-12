# Implementation Roadmap — waves

Ground rules: no schema changes, no scoring/queryA edits, no `.env` reads, no commits/pushes without explicit approval, enrichment job owns `canonical_products` writes. Every wave verifiable via `verification-checklist.md`; rollback = `git revert` (all UI/copy/route-level) — nothing here is destructive.

---

## Wave 1 — Must fix before launch (the 8 blockers) · est. 2–3 days
**Goal:** no overclaims, no wrong labels, no quota exposure, no broken share cards.

| Item | Files | Risk |
|---|---|---|
| LB-1 copy: remove "world's only" ×3 | `app/page.tsx`, `app/about/page.tsx` | None (copy; founder approves wording) |
| LB-2 trust server format in search labels | `app/search/page.tsx` | Low — display + filter mapping only |
| LB-3 ISBN-key or suppress price hints | `app/search/page.tsx`, `app/api/price-hint/route.ts` | Low-med — touches eBay call path, keep cache keys versioned |
| LB-4 add `public/og-image.png` | asset only | None |
| LB-5 search empty state + drop `/search` from sitemap | `app/search/page.tsx`, `app/sitemap.ts` | None *(sitemap is SEO-critical — this is a removal of one static entry only)* |
| LB-6 rate-limit price-hint + comic/[id] | 2 route files | Low — same limiter as 5 existing routes, kill switch exists |
| LB-7 rename "Top deals" + pinned curation + drop fake "-N%" | `app/page.tsx`, `app/api/homepage-deals/route.ts` | Low — additive pinned-slug list, keep algorithmic fill |
| LB-8 Amazon decision (resync once OR hide) | founder decision + 1 script run | Decision-gated |

**Verify:** prod smoke (Smoke Test V4) + curl 429 checks + opengraph preview + flagship search eyeball.
**Claude action:** `claude-fix-prompts.md` §1–§6.

## Wave 2 — Should fix before launch (credibility polish) · est. 1–2 days
- Hide Price History module until ≥2 points (`app/product/[slug]/page.tsx`).
- Fix "(1 listing)" heading — count only what the tabs count, or label "tracked retailers".
- Series pages: soften "every volume" copy; truncate CV description to first paragraph + "Source: ComicVine" attribution (`lib/series/getSeriesData.ts` or `SeriesHero`).
- Sitemap quality gate: only products with cover AND (priced offer OR description) — one WHERE clause in `app/sitemap.ts` *(hands-off-adjacent: get explicit approval)*.
- Add "Report an issue" mailto on product pages.
- Gate homepage static-CV-cover effect on homepage-deals result (stop 10 wasted CV calls/visit).
- Fix distributor-as-publisher on flagship Absolutes (targeted data fix, ~5 rows, coordinate with enrichment job).
- Delete scaffold SVGs from `public/`.

## Wave 3 — Launch-week monitoring · est. ½ day + habits
- Weekly (or daily during launch week) run of `scripts/audit-launch-readiness-stats.ts`; paste deltas into Mission Control.
- Founder toggles: Vercel Spend Management cap, GitHub secret scanning, Dependabot.
- Launch-day runbook page in `launch/` (deploy → smoke → watch → rollback tag `PRE-MONSTER-MODE-LAUNCH-STABLE-2026-07-03`).
- Add "issue-grid covers render on real devices" to Smoke Test V4 checklist (verify the comicvine.gamespot.com hotlink question).
- Watch Vercel function invocations + KV usage after rate-limit deploy.

## Wave 4 — Post-launch compounding (ordered by leverage)
1. **Second priced retailer live** (Wordery or Bookshop — adapters + scripts exist, currently 0 priced listings). This single item converts "price list" into "price comparison" for real. Then Waterstones dynamic pricing.
2. Price-history accumulation → sparkline becomes real; then price-drop alerts (the habit loop).
3. SSR search results (CWV + SEO).
4. CV→R2 cover migration for hotlinked images; OL hotlink backlog ×3,485.
5. Duplicate-edition grouping in search (sibling ISBNs → one card with edition picker).
6. Creators/synopsis backfill for top-100 series; standardise `cv_match_suspect` shape + auto-hide rule.
7. Structured report-wrong-data form feeding the suspect queue.
8. Community/collections — only after the above holds.
