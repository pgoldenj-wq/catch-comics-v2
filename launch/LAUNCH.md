# Catch Comics — Launch Contract

**Launch date:** July 1, 2026  
**Launch type:** Soft launch to collector communities (Reddit, Discord, Facebook groups)  
**Launch promise:** A collector can search for a comic, follow a reading order, compare prices across UK retailers, and trust the information they see.

**Completion: auto-calculated from requirement statuses below**  
Last updated: 2026-06-08 (session 2)

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

### 2. Reading Order Journeys (20 curated series) — STRATEGIC BLOCKER
**Status:** 18 of 20 complete — 2 hard blockers remain  
**Done when:** All 20 series pages live, each passing the quality bar: ≥3 collected editions with correct `comicvine_id` + `volumeNumber`, ≥2 UK retailers with live Vol. 1 price, valid synopsis, correct sort order.  
**Blocked by:** Naruto (complex 3-in-1/catalogue data mix, needs human triage) · Baki the Grappler (Kodama Tales English edition not yet indexed on ComicVine)  
**Quality bar:** Do NOT add any series where `volumeNumber` values are wrong or fewer than 2 retailers price Vol. 1.  
**Build order (all complete):** ~~Saga~~ ✓ → ~~Trigun Maximum Deluxe~~ ✓ → ~~Laid-Back Camp~~ ✓ → ~~Ouran OHSHC~~ ✓ → ~~Witch Hat Atelier~~ ✓ → ~~Hellsing~~ ✓ → ~~Void Rivals~~ ✓ → ~~Sengoku Youko~~ ✓ → ~~Under Ninja~~ ✓ → ~~Innocent Omnibus~~ ✓ → ~~Wolf's Daughter~~ ✓ → ~~Eden of Witches~~ ✓ → ~~Multi-Mind Mayhem~~ ✓ → ~~The Walking Dead~~ ✓ → ~~Fullmetal Alchemist~~ ✓ → ~~Invincible~~ ✓ → ~~Claymore~~ ✓ → ~~Overlord~~ ✓ | Naruto ⛔ BLOCKED | Baki the Grappler ⛔ BLOCKED

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

### 11. Vercel Production Env Vars + Inngest Sync
**Status:** Done (2026-06-07)  
**Done when:** ✓ Complete. All 30 Vercel Production vars cross-checked against `.env.local` and full codebase grep. Zero launch-critical gaps.  
**Inngest sync fix:** ✓ Complete (2026-06-07). Root cause: Vercel was sending per-deployment preview URLs to Inngest instead of the canonical domain, causing 9+ unattached sync failures since May 29. Fix: `INNGEST_SERVE_NEXT_URL=https://catchcomics.com/api/inngest` added to Vercel Production. Redeployed at 21:48 BST. Manual resync triggered in Inngest dashboard by operator. All 8 codebase functions now registered in Production: sync-retailer, sync-scheduled, enrich-canonical, cleanup-stale, price-check, on-failure, bookshop-lookup, bookshop-refresh. Future deployments will sync to catchcomics.com, not to ephemeral deployment URLs. No outstanding Inngest concerns.  
**Note:** `INNGEST_SERVE_NEXT_URL` is scoped to Production only, so development and preview environments are unaffected.

---

### 12. R2 Image Domain Verification
**Status:** Done (2026-06-07)  
**Launch-critical:** YES — broken cover images kill first impressions  
**Priority:** Required before launch  
**Done when:** ✓ Complete. `https://images.catchcomics.com` custom domain live and serving production cover images via Cloudflare.  
**Verified (2026-06-07):**
- Domain routing: HTTP 404 at root (Cloudflare backend, expected — no object at `/`)
- Real image test: 3 independent `.webp` cover files each returned HTTP 200 OK, `Content-Type: image/webp`, served by Cloudflare
- Example: `https://images.catchcomics.com/covers/02bda695-f7d3-4bdf-9544-af49622d281b.webp` (Wings of Fire #8) — 12,710 bytes, HTTP 200
- Production API (`/api/homepage-deals`) confirms enriched products use `images.catchcomics.com` URLs, not fallback domains
- Note: unenriched products retain `covers.openlibrary.org` fallback URLs — this is expected and correct behaviour. R2 URLs are written during enrichment; the fallback is safe.

---

### 13. Operational Alerting — Slack Webhook
**Status:** Deferred — post-launch enhancement  
**Launch-critical:** NO  
**Priority:** Post-launch / Nice-to-have operational task  
**Implementation status:** ✅ Code complete. `lib/inngest/functions/on-failure.ts` fully implemented. Triggers on `inngest/function.failed` (fires automatically when any function exhausts all retries). Posts a formatted Block Kit message to the webhook URL. Graceful fallback if Slack is unreachable. No code changes required to activate.  
**Remaining work (estimated 5–10 minutes when ready):**
1. Create Slack app at `api.slack.com/apps` → Incoming Webhooks → add to `#catch-comics-ops`
2. Add `SLACK_WEBHOOK_URL` to Vercel Production (Production scope only)
3. Redeploy
4. Send test event via Inngest dashboard: `inngest/function.failed` with synthetic payload
5. Confirm message appears in `#catch-comics-ops`

**What you miss without it:** AWIN sync failures, enrichment stoppages, cover upload errors, and background job crashes are only visible by manually checking the Inngest dashboard or Vercel function logs. Silent degradation window: potentially days.  
**Risk if permanently deferred:** Low at launch. Grows as traffic and reliance on background jobs increases.

---

## NOT Launch-Day Critical — Launch Week 2

The following are real improvements that come immediately after launch, informed by user feedback:

- **Collection Pages (5 editorial collections)** — Build week of July 1, informed by what series pages users engage with
- **Homepage redesign** — Update after seeing how collectors navigate from community posts
- **Full catalogue cover backfill** — Running in background, completes post-launch
- **Full catalogue CV enrichment** — Running in background, completes post-launch
- **Character / Creator / Publisher Pages** — Post-launch, requires ~30–40% CV coverage

### Nice-to-have operational tasks (deferred, implementation complete)

- **Slack Alerting** — Add `SLACK_WEBHOOK_URL` to Vercel Production. Code is done. 5–10 min effort. Prevents silent degradation of background jobs post-launch. See item 13 above for full steps.

---

## Completion by Area

| Area | Priority | Status | % done |
|---|---|---|---|
| CV Enrichment (launch series) | Required | In progress (18/20 series enriched) | 85% |
| Reading Journeys | Required | 18/20 done — 2 hard blockers (Naruto, Baki) | 90% |
| Cleanup v2 | Required | Done | 100% |
| AWIN write mode | Required | Done | 100% |
| Search | Required | Functional | 80% |
| Product Pages | Required | Good | 75% |
| Affiliate Tracking | Required | Good | 85% |
| Legal Pages | Required | Done | 100% |
| Series Index + Navbar | Required | Not started | 0% |
| Vercel Env Vars + Inngest | Required | Done | 100% |
| R2 Image Domain | Required | Done | 100% |
| Slack Alerting | Post-launch | Deferred — code complete, webhook not yet created | — |

**Overall: ~79%** *(required items only — Slack excluded)*  
*(Reading Journeys now 90% (18/20). CV Enrichment 85%. Only Series Index + Navbar remains at 0% of required items — all others 75%+. Two hard blockers: Naruto needs catalogue triage, Baki needs ComicVine to index Kodama Tales edition.)*

---

## Critical Path — Steps

1. ~~Cleanup v2 sign-off and execute~~ ✓ Done 2026-06-07
2. ~~Series list defined — 20 series named, scored, and verified~~ ✓ Done 2026-06-07 (see BACKLOG.md)
3. ~~Series pages Tier 1~~ ✓ Done 2026-06-08 — Saga, Trigun Maximum Deluxe, Laid-Back Camp, Ouran OHSHC, Witch Hat Atelier (all repaired and shipped)
4. ~~Series pages Tier 2~~ ✓ Done 2026-06-08 — Hellsing, Void Rivals, Sengoku Youko, Under Ninja
5. ~~Series pages Tier 3~~ ✓ Done 2026-06-08 — Innocent Omnibus, Wolf's Daughter, Eden of Witches, Multi-Mind Mayhem | **Naruto ⛔ BLOCKED** (needs human triage) | **Baki ⛔ BLOCKED** (needs ComicVine indexing)
6. **Series index page at /series** ← NEXT
7. **Navbar update — add /series link** ← NEXT
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
