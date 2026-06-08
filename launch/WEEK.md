# Catch Comics — Week of 2026-06-06

**Launch date:** July 1, 2026 — **23 days remaining**  
**Week objective:** Clear all no-blocker items. Sign off cleanup v2. Define the series list. Ship Tier 1 series pages.

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
**Status:** done
**Done when:** ✓ Complete. 20 series defined, DB-gate verified, scored, and ranked. Ranked table written to `launch/BACKLOG.md`.  
**Blocked by:** —  
**Completed:** 2026-06-07. ✅ SHIPPED. DB query found 591 series with ≥3 editions; 19 pass the full gate (vol1 exists, ≥2 UK retailers). With 5 already-done series = 20 total. Scored on 5 dimensions. Top 5 to build: Saga (80.5), Witch Hat Atelier (76.0), Ouran High School Host Club (71.0), Trigun Maximum Deluxe (71.5), Laid-Back Camp (72.3). Full table and data quality flags in BACKLOG.md. Aspirational series (Watchmen, Sandman, etc.) fail the DB gate — root causes documented.

---

### 4. Saga series page — Build and ship
**Area:** Reading Orders  
**Launch-critical:** YES  
**Status:** done
**Done when:** ✓ Complete. `/series/saga` live, SSG with 1h revalidate. 11 volumes in DB (vols 1–6, 8–9, 11–12 + 1 unnumbered). All R2 covers. Vol.1 at £7.49 from 2 retailers (Travelling Man, Waterstones). Description populated from CV data via `stripHtml`. TypeCheck clean, build passing. Data quality notes: vols 4–6, 8–9 reclassified from format=OTHER to TPB and assigned comicvineId=46568. Vols 7 and 10 absent from DB (not in retailer feeds — known gap, does not block launch). Vol.1–3 covers backfilled to R2 via CV issue art.  
**Blocked by:** —  
**Completed:** 2026-06-07. ✅ SHIPPED.

---

### 6. Legal pages — Create
**Area:** Legal  
**Launch-critical:** YES  
**Status:** done
**Done when:** Privacy Policy at `/privacy` (enhanced with AWIN, server logs, third-party processors, UK GDPR rights). Affiliate Disclosure at `/affiliate-disclosure` (AWIN, Amazon Associates, eBay, ranking honesty, price accuracy). Shared SiteFooter on all pages with legal links. CookieNotice component (minimal honest, no fake consent). Date updated 7 June 2026. Solicitor review recommended before full public launch.  
**Blocked by:** —

---

### 7. Verify Vercel production env vars + Inngest sync
**Area:** Retailers  
**Launch-critical:** YES  
**Status:** done
**Done when:** All 30 Vercel Production vars cross-checked against .env.local and full codebase grep. Zero launch-critical vars missing. Inngest sync root cause fixed (INNGEST_SERVE_NEXT_URL added). All 8 functions registered in Production after manual resync: sync-retailer, sync-scheduled, enrich-canonical, cleanup-stale, price-check, on-failure, bookshop-lookup, bookshop-refresh. Future deployments will sync to catchcomics.com, not ephemeral Vercel URLs.  
**Blocked by:** —  
**Completed:** 2026-06-07. ✅ SHIPPED — 0 launch-critical gaps. Inngest permanently fixed.

---

### 8. R2 image domain — Verify custom domain
**Area:** Infrastructure  
**Launch-critical:** YES  
**Status:** done
**Done when:** `https://images.catchcomics.com` confirmed live. Real cover images serving from custom domain.  
**Blocked by:** —  
**Completed:** 2026-06-07. ✅ SHIPPED. Domain routing via Cloudflare confirmed (HTTP 404 at root, healthy). Three independent cover image URLs each returned HTTP 200 OK, `image/webp`, served by Cloudflare. Example: `/covers/02bda695-f7d3-4bdf-9544-af49622d281b.webp` (Wings of Fire #8, 12,710 bytes). Production API confirms enriched products use `images.catchcomics.com` URLs. Unenriched products retain `covers.openlibrary.org` fallback — correct behaviour.

---

---

### 9. Trigun Maximum Deluxe — Build and ship
**Area:** Reading Orders  
**Launch-critical:** YES  
**Status:** done  
**Done when:** ✓ Complete. `/series/trigun-maximum-deluxe` live. 5 volumes in order (Vols 1-5), all DELUXE format, all priced (from £14.99). Vol.1 "START HERE" badge. CV:29569 confirmed across all 5 products. No cover gaps. TypeCheck clean.  
**Completed:** 2026-06-07. ✅ SHIPPED.

---

### 10. Laid-Back Camp — Repair and build
**Area:** Reading Orders  
**Launch-critical:** YES  
**Status:** done  
**Done when:** ✓ Complete. `/series/laid-back-camp` live. 17 volumes in order (Vols 1-17), all MANGA_VOLUME format, all priced (from £7.99). Vol.1 "START HERE" badge at £7.99. Data repairs: 15 volume_numbers fixed, 17 formats → MANGA_VOLUME, 5 orphan CV IDs set, 5 series_names set. TypeCheck clean.  
**Completed:** 2026-06-08. ✅ SHIPPED.

---

### 11. Ouran High School Host Club — Repair and build
**Area:** Reading Orders  
**Launch-critical:** YES  
**Status:** done  
**Done when:** ✓ Complete. 18 volumes all present and numbered. Retailer listing evidence (retailer bb626f10) resolved 10 bare-titled products. Vol 7 absent from DB — inserted via Google Books (ISBN 9781421508641, sequential position confirmed). All 18 covers present. TypeCheck clean.  
**Completed:** 2026-06-08. ✅ SHIPPED.

---

### 12. Witch Hat Atelier — Repair and build
**Area:** Reading Orders  
**Launch-critical:** YES  
**Status:** done  
**Done when:** ✓ Complete. 14 volumes (Vols 1-14). 5 missing vols (2,5,6,7,8) inserted via Google Books (Kodansha ISBNs). Grimoire/supplemental editions set to DELUXE+NULL vol_number (sort to page end). All formats MANGA_VOLUME. All covers present. TypeCheck clean.  
**Completed:** 2026-06-08. ✅ SHIPPED.

---

### 13. Tier 2 — Hellsing, Void Rivals, Sengoku Youko, Under Ninja
**Area:** Reading Orders  
**Launch-critical:** YES  
**Status:** done  
**Done when:** ✓ Complete. All 4 series pages live. 3 missing vols inserted (SY Vol 5 + UN Vols 5,6 via Google Books). 8 format/vol_number repairs applied. Covers sourced.  
**Completed:** 2026-06-08. ✅ SHIPPED.

---

### 14. Tier 3 — Innocent Omnibus, Wolf's Daughter, Eden of Witches, Multi-Mind Mayhem
**Area:** Reading Orders  
**Launch-critical:** YES  
**Status:** done  
**Done when:** ✓ Complete. All 4 series pages live. Notable repairs: Innocent Rouge Omnibus CV ID corrected 157999→171481 (prevented series page contamination); Eden of Witches Vols 5-7 CV IDs set to 161324; Wolf's Daughter Vol 2 volume_number set; format TPB→MANGA_VOLUME across all three manga publishers.  
**Completed:** 2026-06-08. ✅ SHIPPED.

---

### 15. Series Index + Navbar
**Area:** Reading Orders + UX  
**Launch-critical:** YES  
**Status:** todo  
**Done when:** `/series` accessible from navbar. All 18 shipped series listed, browsable on mobile. One click from any page.  
**Blocked by:** —  
**Note:** The last 0% required item before launch. All series pages now exist. This is the final unlock.

---

### 16. Naruto — Triage
**Area:** Reading Orders  
**Launch-critical:** NO (blocked — deferred)  
**Status:** blocked  
**Done when:** Main series volumes 1–72 mapped to a consistent CV ID with correct volume_numbers. Decision made on which edition to feature (3-in-1 omnibus vs individual volumes).  
**Blocked by:** 81 products with cv=NULL. Complex mix of 3-in-1 editions and individual volumes. Would need catalogue-wide enrichment + editorial decision. **Do not attempt without human sign-off.**

---

### 17. Baki the Grappler — Monitor ComicVine
**Area:** Reading Orders  
**Launch-critical:** NO (blocked — waiting on external)  
**Status:** blocked  
**Done when:** ComicVine indexes the Kodama Tales English edition of Baki the Grappler. Then: run `npm run ingest:cv-series -- --search "Baki the Grappler Kodama"`, set CV IDs on 20 DB products, fix Vols 7-10 volume_numbers (currently NULL), add slug to registry, build.  
**Blocked by:** ComicVine has no entry for Kodama Tales edition yet (pub Oct 2025). 20 volumes + covers + pricing are already in DB. This is a 15-minute task once ComicVine has the data.

---

## Rules

- No work starts without a card in "In Progress" on the board.
- Launch-critical cards take priority.
- **Status values:** `todo` | `in-progress` | `done` — update the Status field as work progresses.
- WEEK.md is rewritten every Monday. Done items from the week are removed.
- This file feeds the dashboard. Stale status = wrong dashboard.
