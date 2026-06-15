# Catch Comics — Week of 2026-06-15

**Launch date:** July 1, 2026 — **16 days remaining**  
**Week objective:** Complete smoke test. Verify mailbox. Hide price filter. Write launch announcement.

---

## This Week's Priorities

### 1. Production smoke test
**Area:** Quality  
**Launch-critical:** YES  
**Status:** in-progress  
**Done when:** Walk through the following on the production URL (`catchcomics.com`):
- [x] Click a retailer link → `/go/[id]` redirects with affiliate params — verified 2026-06-15 via curl (Amazon `?tag=catchcomics-21`; AWIN `awin1.com/cread.php` with `awinmid`, `awinaffid=2888331`, `clickref=cc-XXXXXXXX`, clean `ued` / no double-wrap)
- [x] Navigate to `/series` → index page loads, 17 series visible — verified
- [x] Confirm click event written to DB — verified (redirect clicks logged to `click_events`)
- [ ] Search for "Saga" → product page loads, cover visible, prices shown (visual — manual)
- [ ] Click a series → `/series/saga` loads with Start Here badge and Vol 1 price (visual — manual)
- [ ] Click "Start Reading" → product page for Vol 1 loads (visual — manual)
- [ ] Confirm AWIN click is recorded in AWIN dashboard (external — manual)
- [ ] Mobile test: search + series page on phone (manual)

**Smoke-test stabilisation sprint (2026-06-15) — fixed & deployed:** homepage horizontal overflow; homepage Top Deals + `/series` real-cover preference (homepage 12/12, series 14/17 covers); search "Did you mean" suppressed on confident matches; eBay item URLs normalised to `.co.uk`; series synopsis Read-more; 404 neutral CTA; cover hover-enlarge disabled on touch; character-tag "+N more" removed. **OffersTable trust pass (done 2026-06-15):** unreliable availability column removed (feed OOS false-positives), duplicate eBay badge suppressed, eBay New/Used mapping fixed. _Documented (correct as-is):_ Bookshop ordering is cheapest-first (no retailer-priority list); FMA ordering correct (vols 2/7/12/22/25/26 missing = data gap); creators are static text, not dead links. _Deferred (data/structural):_ 3 series OL-only covers, single-issue vs volume layout, recommendation diversification.
**Effort:** 1 hr

---

### 2. Verify hello@catchcomics.com mailbox
**Area:** Legal / Ops  
**Launch-critical:** YES  
**Status:** todo  
**Done when:** Confirm the mailbox at hello@catchcomics.com is live and monitored. This address appears in the Privacy Policy and Footer on every page. A bounced email on launch day is a credibility failure and a UK GDPR risk.  
**Effort:** 5 min

---

### 3. Search — Fix or hide non-functional price filter
**Area:** UX  
**Launch-critical:** NEAR  
**Status:** todo  
**Done when:** Price range filter is either: (A) hidden from the UI until it's functional, or (B) labelled "Coming soon" to manage expectations. The current state (visually active, silently no-ops) is misleading.  
**Effort:** 30 min

---

### 4. Launch announcement copy
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

### 5. Naruto — Reading journey
**Area:** Series  
**Launch-critical:** YES  
**Status:** todo  
**Blocked by:** Human triage required — complex 3-in-1/catalogue data mix, needs human sign-off. Do not attempt without dedicated session.  
**Done when:** Naruto series page live with correct volume data and ≥2 retailers pricing Vol 1.  
**Effort:** 1–2 hrs when unblocked

---

### 6. Baki the Grappler — Reading journey
**Area:** Series  
**Launch-critical:** YES  
**Status:** todo  
**Blocked by:** ComicVine not yet indexed Kodama Tales English edition (published Oct 2025). Monitor weekly.  
**Done when:** CV IDs set, volume numbers fixed, added to series registry. ~15 min once CV indexes it.  
**Effort:** 15 min when unblocked

---

### DEFERRED — Post-launch

**eBay affiliate attribution:** eBay marketplace clicks currently unmonetised. Investigate eBay EPN setup and parameter injection. Can ship after launch — not blocking.

**Slack alerting:** Code complete. Add `SLACK_WEBHOOK_URL` to Vercel Production when ready. 5–10 min. Prevents silent degradation of background jobs post-launch.

---

## Rules

- No work starts without a card in "In Progress" on the board.
- Launch-critical cards take priority.
- **Status values:** `todo` | `in-progress` | `done` — update the Status field as work progresses.
- WEEK.md is rewritten every Monday. Done items from the week are removed.
- This file feeds the dashboard. Stale status = wrong dashboard.
