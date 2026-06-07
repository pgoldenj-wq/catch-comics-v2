# Catch Comics — Launch Contract

**Launch date:** July 1, 2026  
**Launch type:** Soft launch to collector communities (Reddit, Discord, Facebook groups)  
**Launch promise:** A collector can search for a comic, follow a reading order, compare prices across UK retailers, and trust the information they see.

**Completion: auto-calculated from requirement statuses below**  
Last updated: 2026-06-06

---

## Critical Path Audit — What is ACTUALLY launch-critical?

Items removed from launch-day scope after challenge:

| Item | Was | Now | Reason |
|---|---|---|---|
| Collection Pages (5) | Launch-critical | **Launch week 2** | Series pages fulfil the launch promise. Collections add editorial voice but aren't required for a collector to find, follow, and compare. Build post-launch with real user feedback on what resonates. |
| Full catalogue CV enrichment | Launch-critical | **In-flight, best-effort** | Only the 20–25 launch series need full CV data. Bulk enrichment runs continuously — not gated on launch. |
| Homepage full redesign | Launch-critical | **Minimal change** | Add `/series` link to navbar. That's it. A full homepage redesign is post-launch polish. |
| Null cover backfill (15,965) | Launch-critical | **Launch series only** | `ingest-cv-series` downloads covers directly for each launch series. Full catalogue backfill post-launch. |

**Result:** Smaller critical path. More achievable by July 1. No compromise on the launch promise.

---

## Launch Requirements — Day One

### 1. CV Enrichment for Launch Series — STRATEGIC BLOCKER
**Status:** In progress  
**Done when:** All 20–25 launch series have CV data via `ingest-cv-series`. Each series: cover images stored in R2, synopsis populated, issue relationships working. Bulk enrichment continues in background — does NOT block launch.  
**Blocked by:** Nothing — use `ingest-cv-series` per series, bypasses bulk queue  
**Command:** `npm run ingest:cv-series -- --search "[Series Name]"`

---

### 2. Reading Order Journeys (20–25 curated series) — STRATEGIC BLOCKER
**Status:** In progress (5 of 25 series complete — Walking Dead, FMA, Invincible, Claymore, Overlord)  
**Done when:** 20–25 flagship series pages live, each passing the quality bar: ≥3 collected editions with correct `comicvine_id` + `volumeNumber`, ≥2 UK retailers with live Vol. 1 price, valid synopsis, correct sort order.  
**Blocked by:** Series list definition (this week)  
**Quality bar:** Do NOT add any series where `volumeNumber` values are wrong or fewer than 2 retailers price Vol. 1.

---

### 3. Data Cleanup v2 — CRITICAL PATH UNLOCKER
**Status:** Done (2026-06-07)  
**Done when:** ✓ Complete. 6 non-comic products soft-deleted (academic press). 220 products reclassified (OTHER → MANGA_VOLUME/TPB/OMNIBUS/COMPENDIUM/DELUXE). retailer_listings, price_history, and CV enrichment all confirmed unchanged. Enrichment pipeline was never stopped — it ran without interruption throughout (comicvineId=NULL guard).  
**Blocked by:** —  
**Note:** Unblocks cover backfill. CV API no longer wastes calls on the 226 cleaned rows.

---

### 4. AWIN Write Mode — TACTICAL BLOCKER
**Status:** Done (2026-06-07)
**Done when:** AWIN feeds ingesting in write mode. One affiliate link clicked manually. Attribution confirmed in AWIN dashboard.
**Completed:** 4 retailers GREEN (LetsBuyBooks 5,870 priced, Scholastic 208, Waterstones 15,775, Bookshop.org 537). 22,380 priced AWIN listings total. Monetised catalogue 34.1%. Waterstones merchant ID corrected (3787, was 2079). URL double-wrap bug fixed (merchant_deep_link stored, cread.php wrapped at /go/ redirect). Full clickref attribution active (cc-{listing-id[:8]}).

---

### 5. Product Search
**Status:** Functional  
**Done when:** Search by title and ISBN returns correct results on production URL. Zero results shows clean empty state. No broken product page links from results.  
**Note:** Appears solid — verify on production before launch day.

---

### 6. Product Pages
**Status:** Good (UX overhaul 2026-05-30, post-audit fixes 2026-06-05)  
**Done when:** Product pages load with correct cover, creators, synopsis, and pricing for enriched products. Fallback placeholder shown for unenriched. No console errors.  
**Note:** Best current area. Minor polish only.

---

### 7. Affiliate Tracking
**Status:** Good (eBay + Amazon + AWIN all operational as of 2026-06-07)
**Done when:** `/go/[id]` redirect and click logging verified on production URL. No console errors.

---

### 8. Legal Pages + Disclosures
**Status:** Done (2026-06-07)  
**Done when:** ✓ Complete. Privacy Policy at `/privacy` (enhanced: AWIN, server logs, third-party processors, UK GDPR rights, international transfers, data retention, children). Affiliate Disclosure at `/affiliate-disclosure` (AWIN, Amazon Associates, eBay EPN status, ranking honesty, price accuracy, third-party retailer clarity). Shared SiteFooter on all pages. Minimal CookieNotice (no fake consent). Footer links: About · Affiliate Disclosure · Privacy · Terms. Build passing. Note: solicitor review recommended before full public launch — wording is transparent but not professionally certified.  
**Note:** Contact email is now hello@catchcomics.com across all public pages. Ensure that mailbox is live before public launch.

---

### 9. Series Index Page (`/series`)
**Status:** Not started  
**Done when:** `/series` accessible from navbar. All 20–25 series listed. Browsable on mobile.  
**Blocked by:** Series pages must exist first

---

### 10. Navbar Update
**Status:** Not started  
**Done when:** `/series` link added to navbar. One click from any page to the series index.  
**Note:** Minimal change. Not a full redesign.

---

### 11. Vercel Production Env Vars
**Status:** Unverified  
**Done when:** Every env var in `.env.local` confirmed present in Vercel dashboard. Specifically: `COMIC_VINE_API_KEY`, all AWIN vars, all R2 vars, all eBay vars.  
**Note:** Most common launch failure mode. Verify explicitly before go-live.

---

## NOT Launch-Day Critical — Launch Week 2

The following are real improvements that come immediately after launch, informed by user feedback:

- **Collection Pages (5 editorial collections)** — Build week of July 1, informed by what series pages users engage with
- **Homepage redesign** — Update after seeing how collectors navigate from community posts
- **Full catalogue cover backfill** — Running in background, completes post-launch
- **Full catalogue CV enrichment** — Running in background, completes post-launch
- **Character / Creator / Publisher Pages** — Post-launch, requires ~30–40% CV coverage

---

## Completion by Area

| Area | Status | % done |
|---|---|---|
| CV Enrichment (launch series) | In progress | 20% |
| Reading Journeys | In progress (5/25) | 20% |
| Cleanup v2 | Done | 100% |
| AWIN write mode | Done | 100% |
| Search | Functional | 80% |
| Product Pages | Good | 75% |
| Affiliate Tracking | Good | 85% |
| Legal Pages | Done | 100% |
| Series Index + Navbar | Not started | 0% |
| Vercel Env Vars | Unverified | 50% |

**Overall: ~40%**

---

## Critical Path — Steps

1. ~~Cleanup v2 sign-off and execute~~ ✓ Done 2026-06-07
2. Series list defined — 20–25 series named and verified
3. Series pages Tier 1 — Saga, Watchmen, Sandman, Y: The Last Man, Preacher
4. Series pages Tier 2 — V for Vendetta, The Boys, Locke & Key, Berserk, Akira
5. Series pages Tier 3 — reach 20–25 total
6. Series index page at /series
7. Navbar update — add /series link
8. Launch day checklist and go-live

**Running in parallel (not blocking the path):**
- AWIN write mode (do this week — no blockers)
- Legal pages (do this week — no blockers)
- Vercel env vars (verify this week — no blockers)
- CV enrichment per-series (via ingest-cv-series per series added)
- Cover backfill (after cleanup v2)

---

## Session protocol — start every Claude session with:

```
Read launch/LAUNCH.md and launch/WEEK.md.
Tell me:
1. Current launch % (update if work has shipped since last session)
2. Which WEEK.md item is most critical today
3. One thing I should not touch today
```
