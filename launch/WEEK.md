# Catch Comics — Week of 2026-06-09

**Launch date:** July 1, 2026 — **22 days remaining**  
**Week objective:** Close the discovery gap. Install analytics. Fix Claymore. Ship the launch announcement. Smoke test on production.

---

## This Week's Priorities

### 1. Navbar — Add `/series` link
**Area:** Discovery / UX  
**Launch-critical:** YES  
**Status:** ✅ done (2026-06-08)  
**Done when:** `/series` appears in the Navbar component. One click from any page to the series index. Visible on both mobile and desktop.  
**Evidence:** `components/Navbar.tsx` — usePathname + "Series" link (hidden sm:block); `components/MobileHeader.tsx` — Series link in discovery variant. Build passes.

---

### 2. Homepage — Series discovery section
**Area:** Discovery / UX  
**Launch-critical:** YES  
**Status:** ✅ done (2026-06-08)  
**Done when:** Homepage has a visible "Explore Series" section with 6 series cards and "Browse all series →" CTA.  
**Evidence:** `components/ExploreSeriesSection.tsx` (new); `app/api/series-preview/route.ts` (new ISR route); `app/page.tsx` — import + render. Responsive 3-col mobile / 6-col desktop. OpenLibrary fallbacks on first paint; replaced by live R2 covers from DB on mount. Build passes, 43 pages generated.

---

### 3. Analytics — Install Vercel Analytics
**Area:** Monitoring  
**Launch-critical:** YES  
**Status:** todo  
**Done when:** Vercel Analytics is installed and reporting pageviews in the Vercel dashboard. No external service needed — `@vercel/analytics` ships with Vercel.  
**Effort:** 15 min  
**Command:** `npm install @vercel/analytics` + add `<Analytics />` to `app/layout.tsx`  
**Why now:** Without analytics, you cannot validate the launch. No data = no learning = no iteration.

---

### 4. Claymore — Fix broken reading order
**Area:** Data quality  
**Launch-critical:** YES  
**Status:** todo  
**Done when:** Either (A) Claymore Vol 1 exists in DB with a live priced listing and the "Start Here" badge is correct, OR (B) Claymore is removed from the registry until Vol 1 can be sourced.  
**Effort:** 1 hr  
**Context:** Claymore Vol 1 is absent from DB. The series page at `/series/claymore` shows Vol 2 as "Start Here" — a broken reading order. The full series also has 16 of 27 volumes missing and zero live retailer pricing. Option B (remove from registry) takes 2 minutes; Option A requires finding the Vol 1 ISBN and sourcing retailer coverage.  
**Vol 1 ISBN (Viz Media, 2006):** 9781421500897

---

### 5. AWIN_PUBLISHER_ID — Verify in Vercel production
**Area:** Monetisation  
**Launch-critical:** YES  
**Status:** todo  
**Done when:** Confirm `AWIN_PUBLISHER_ID` is set in Vercel Production environment. If missing, add it.  
**Effort:** 5 min  
**Why now:** If unset, all AWIN clicks redirect without affiliate wrapping — silent revenue failure with only a server-side console warning.

---

### 6. Error monitoring — Install
**Area:** Infrastructure  
**Launch-critical:** YES (pre-launch)  
**Status:** todo  
**Done when:** Production errors are visible somewhere — Vercel's built-in error tracking enabled in dashboard, or Sentry free tier installed (`@sentry/nextjs`). At minimum, know when a page crashes.  
**Effort:** 30 min  
**Why now:** Without monitoring, production crashes are invisible. A broken series page could be live for days post-launch.

---

### 7. Production smoke test
**Area:** Quality  
**Launch-critical:** YES  
**Status:** todo  
**Done when:** Walk through the following on the production URL (`catchcomics.com`):
- [ ] Search for "Saga" → product page loads, cover visible, prices shown
- [ ] Click a retailer link → `/go/[id]` redirects with affiliate params (check URL)
- [ ] Navigate to `/series` → index page loads, 18 series visible
- [ ] Click a series → `/series/saga` loads with Start Here badge and Vol 1 price
- [ ] Click "Start Reading" → product page for Vol 1 loads
- [ ] Confirm AWIN click is recorded in AWIN dashboard
- [ ] Confirm click event written to DB
- [ ] Mobile test: search + series page on phone
**Effort:** 1 hr

---

### 8. Search — Fix or hide non-functional price filter
**Area:** UX  
**Launch-critical:** NEAR  
**Status:** todo  
**Done when:** Price range filter is either: (A) hidden from the UI until it's functional, or (B) labelled "Coming soon" to manage expectations. The current state (visually active, silently no-ops) is misleading.  
**Effort:** 30 min

---

### 9. Launch announcement copy
**Area:** Go-to-market  
**Launch-critical:** YES  
**Status:** todo  
**Done when:** Draft posts ready for:
- Reddit: r/comicbooks, r/manga, r/graphicnovels (separate tailored posts)
- Discord: relevant collector communities
- Facebook: comic collector groups
Copy should include: what Catch Comics does, 2–3 example series pages with direct links, CTA to browse all 18 series.  
**Effort:** 2–3 hrs (writing + editing)

---

### 10. Verify hello@catchcomics.com mailbox
**Area:** Legal / Ops  
**Launch-critical:** YES  
**Status:** todo  
**Done when:** Confirm the mailbox at hello@catchcomics.com is live and monitored. This address appears in the Privacy Policy and Footer on every page.  
**Effort:** 5 min

---

### DEFERRED — Blocked
*(These are real tasks that are explicitly waiting on something external)*

**Naruto triage:** Catalogue-wide enrichment + editorial decision required. Do not attempt without human sign-off. Blocked until dedicated session.

**Baki the Grappler:** Waiting for ComicVine to index Kodama Tales English edition (pub Oct 2025). When it appears: set CV IDs, fix vol numbers, add to registry. ~15 min task.

**eBay affiliate attribution:** eBay marketplace clicks currently unmonetised. Investigate eBay EPN setup and parameter injection. Can ship after launch — not blocking.

---

## Rules

- No work starts without a card in "In Progress" on the board.
- Launch-critical cards take priority.
- **Status values:** `todo` | `in-progress` | `done` — update the Status field as work progresses.
- WEEK.md is rewritten every Monday. Done items from the week are removed.
- This file feeds the dashboard. Stale status = wrong dashboard.
