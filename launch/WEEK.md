# Catch Comics — Week of 2026-06-06

**Launch date:** July 1, 2026 — **25 days remaining**  
**Week objective:** Clear all no-blocker items. Sign off cleanup v2. Define the series list.

---

## This Week's Priorities

### 1. Cleanup v2 — Sign off and execute
**Area:** Enrichment  
**Launch-critical:** YES  
**Status:** done
**Done when:** Dry-run reviewed and approved. Execute command run. 6/6 soft-deletes confirmed. 220/220 format reclassifications confirmed. retailer_listings, price_history, and CV enrichment all unchanged. Enrichment unaffected — pipeline ran without interruption throughout (comicvineId guard).  
**Blocked by:** —  
**Commands:**
```
npm run cleanup:noncomics:dry-c
npm run cleanup:noncomics:execute-c
```

---

### 2. AWIN write mode — Enable and verify
**Area:** Monetisation  
**Launch-critical:** YES  
**Status:** done
**Done when:** AWIN feeds ingesting in write mode. One affiliate link clicked. Attribution confirmed in AWIN dashboard.  
**Blocked by:** —
**Completed:** 2026-06-07. 4 retailers GREEN (LetsBuyBooks 5,870 priced, Scholastic 208, Waterstones 15,775, Bookshop.org 537). 22,380 priced AWIN listings. Monetised catalogue: 34.1%. Waterstones merchant ID corrected (3787, was 2079). URL double-wrap bug fixed. Full clickref attribution via /go/ route.

---

### 3. Launch series list — Define and rank
**Area:** Reading Orders  
**Launch-critical:** YES  
**Status:** todo
**Done when:** 20–25 series named, ranked, and added to BACKLOG.md. Each verified: ≥3 collected editions in DB, ≥2 retailer prices on Vol. 1. Ready to build next week.  
**Blocked by:** —

---

### 4. Legal pages — Create
**Area:** Legal  
**Launch-critical:** YES  
**Status:** done
**Done when:** Privacy Policy at `/privacy` (enhanced with AWIN, server logs, third-party processors, UK GDPR rights). Affiliate Disclosure at `/affiliate-disclosure` (AWIN, Amazon Associates, eBay, ranking honesty, price accuracy). Shared SiteFooter on all pages with legal links. CookieNotice component (minimal honest, no fake consent). Date updated 7 June 2026. Solicitor review recommended before full public launch.  
**Blocked by:** —

---

### 5. Verify Vercel production env vars
**Area:** Retailers  
**Launch-critical:** YES  
**Status:** todo
**Done when:** Every `.env.local` var confirmed in Vercel dashboard. Specifically: COMIC_VINE_API_KEY, AWIN_*, R2_*, eBay vars.  
**Blocked by:** —

---

## Rules

- No work starts without a card in "In Progress" on the board.
- Launch-critical cards take priority.
- **Status values:** `todo` | `in-progress` | `done` — update the Status field as work progresses.
- WEEK.md is rewritten every Monday. Done items from the week are removed.
- This file feeds the dashboard. Stale status = wrong dashboard.
