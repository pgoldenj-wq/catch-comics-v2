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

## Rules

- No work starts without a card in "In Progress" on the board.
- Launch-critical cards take priority.
- **Status values:** `todo` | `in-progress` | `done` — update the Status field as work progresses.
- WEEK.md is rewritten every Monday. Done items from the week are removed.
- This file feeds the dashboard. Stale status = wrong dashboard.
