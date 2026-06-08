# Catch Comics — Week of 2026-06-09

**Launch date:** July 1, 2026 — **22 days remaining**  
**Week objective:** ~~Install analytics~~ ✅. Ship the launch announcement. Smoke test on production.

---

## This Week's Priorities

### 1. Analytics — Install Vercel Analytics
**Area:** Monitoring  
**Launch-critical:** YES  
**Status:** done  
**Done when:** ✓ Complete (2026-06-08). `@vercel/analytics` installed, `<Analytics />` added to `app/layout.tsx`. Build passes. Privacy policy updated to disclose Vercel Analytics.  
**Effort:** 15 min  
**Command:** `npm install @vercel/analytics` + add `<Analytics />` to `app/layout.tsx`  
**Why now:** Without analytics, you cannot validate the launch. No data = no learning = no iteration.

---

### 1b. Speed Insights — Enable Vercel Speed Insights
**Area:** Monitoring  
**Launch-critical:** NO — pre-launch enhancement (recommended)  
**Status:** todo  
**Done when:** `@vercel/speed-insights` installed, `<SpeedInsights />` in `app/layout.tsx`, Core Web Vitals visible in Vercel dashboard after first production traffic.  
**Effort:** 10 min  
**Why now:** Zero cost (included in Observability Plus, already enabled). Surfaces LCP/CLS/INP/FCP/TTFB per page from real users from day one. Lets you catch slow cover-image loads and price-loading CLS shifts before they become user complaints.

---

### 2. AWIN_PUBLISHER_ID — Verify in Vercel production
**Area:** Monetisation  
**Launch-critical:** YES  
**Status:** done  
**Done when:** ✓ Complete (2026-06-08). Vercel CLI confirmed present in Production. Live production test on Bookshop.org (UK) listing: redirect to awin1.com with correct awinaffid (7-digit publisher ID), awinmid, clickref=cc-{listingId[:8]}, clean ued — no double-wrap. HTTP 302. Attribution fully operational.  
**Effort:** 5 min  
**Why now:** If unset, all AWIN clicks redirect without affiliate wrapping — silent revenue failure with only a server-side console warning.

---

### 3. Error monitoring — Install
**Area:** Infrastructure  
**Launch-critical:** YES (pre-launch)  
**Status:** done  
**Done when:** ✓ Complete (2026-06-08). Vercel Observability Plus covers all server-side errors. Client-side forwarding added: error.tsx → POST /api/log-error → Vercel server logs. No Sentry needed. Build passes.  
**Effort:** 30 min  
**Why now:** Without monitoring, production crashes are invisible. A broken series page could be live for days post-launch.

---

### 3c. CV Enrichment — Optimise throughput
**Area:** Infrastructure  
**Launch-critical:** NO — best-effort background task  
**Status:** done  
**Done when:** ✓ Complete (2026-06-08). Diagnosis confirmed bulk enrichment is off the launch critical path. Three low-risk throughput improvements applied to `scripts/enrich-loop.ps1` and `scripts/enrich-loop-w2.ps1`:  
1. **rateMs 25s → 20s** — reduces per-request delay from 25,000ms to 20,000ms. W1 stays at ~180 req/hr vs 200 req/hr API limit (10% buffer). Zero 420 errors in full history. Expected W1 matches/hr: 26 → ~39.  
2. **S0 Low Power Idle blocked** — `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` added to both loop scripts. Prevents Modern Standby Network Disconnected state while wrapper is alive. Sleep and hibernate already disabled (confirmed via powercfg).  
3. **Restart delay 30s → 5s** — reduces dead time between worker sessions from 30s to 5s.  
**ETA (continuous, W1):** ~June 15 (Scenario C). W2 noted exhausted: 0.4% current match rate (pool of TPB/HC/OTHER comics is depleted). All remaining productive work from W1.  
**⚠️ These changes take effect on next worker restart.** Running Scheduled Tasks are using the old script content. Restart both tasks to apply: Task Scheduler → CatchComicsEnrichment → End Task → Run, and CatchComicsEnrichment-W2 → End Task → Run.

---

### 3b. Inngest — Stop DYNAMIC_LINK retailers from entering the sync queue
**Area:** Infrastructure  
**Launch-critical:** NO — operational health  
**Status:** done  
**Done when:** ✓ Complete (2026-06-08). Added `DYNAMIC_LINK` to `SKIP_PLATFORMS` in `lib/sync/dispatch.ts`. 8 active DYNAMIC_LINK retailers (Bookshop UK, Wordery, Forbidden Planet, Waterstones, WHSmith, Hive, Zavvi, AbeBooks) were being dispatched hourly, throwing on every run, exhausting 3 retries, and triggering `on-failure`. Eliminated ~960 failing Inngest invocations/day (~6,720/week) and stopped 192 stuck `status='running'` SyncLog rows accumulating daily. DYNAMIC_LINK retailers have no feed to sync — their listings are generated from ISBN URL templates at seed time.  
**Effort:** 5 min

---

### 4. Production smoke test
**Area:** Quality  
**Launch-critical:** YES  
**Status:** todo  
**Done when:** Walk through the following on the production URL (`catchcomics.com`):
- [ ] Search for "Saga" → product page loads, cover visible, prices shown
- [ ] Click a retailer link → `/go/[id]` redirects with affiliate params (check URL)
- [ ] Navigate to `/series` → index page loads, 17 series visible
- [ ] Click a series → `/series/saga` loads with Start Here badge and Vol 1 price
- [ ] Click "Start Reading" → product page for Vol 1 loads
- [ ] Confirm AWIN click is recorded in AWIN dashboard
- [ ] Confirm click event written to DB
- [ ] Mobile test: search + series page on phone
**Effort:** 1 hr

---

### 5. Search — Fix or hide non-functional price filter
**Area:** UX  
**Launch-critical:** NEAR  
**Status:** todo  
**Done when:** Price range filter is either: (A) hidden from the UI until it's functional, or (B) labelled "Coming soon" to manage expectations. The current state (visually active, silently no-ops) is misleading.  
**Effort:** 30 min

---

### 6. Launch announcement copy
**Area:** Go-to-market  
**Launch-critical:** YES  
**Status:** todo  
**Done when:** Draft posts ready for:
- Reddit: r/comicbooks, r/manga, r/graphicnovels (separate tailored posts)
- Discord: relevant collector communities
- Facebook: comic collector groups
Copy should include: what Catch Comics does, 2–3 example series pages with direct links, CTA to browse all 17 series.  
**Effort:** 2–3 hrs (writing + editing)

---

### 7. Verify hello@catchcomics.com mailbox
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
