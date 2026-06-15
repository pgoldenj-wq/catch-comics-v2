# Catch Comics — Launch Contract

**Launch date:** July 1, 2026  
**Launch type:** Soft launch to collector communities (Reddit, Discord, Facebook groups)  
**Launch promise:** A collector can search for a comic, follow a reading order, compare prices across UK retailers, and trust the information they see.

**Completion: auto-calculated from requirement statuses below**  
Last updated: 2026-06-15 (session 5 — production deployment, CV enrichment complete, dashboard sync)

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
**Status:** Done (2026-06-15)  
**Done when:** ✓ Complete (2026-06-15). All 18 active launch series have CV data: cover images in R2, synopsis populated, issue relationships working. Bulk enrichment workers also complete — W1 processed 18,428 IDs, W2 processed 12,157 IDs (30,585 total, 0 candidates remaining). Workers stopped 2026-06-10. The 2 blocked series (Naruto, Baki) are tracked in Item 2 and do not affect this status.  
**Note:** Run `npm run ingest:cv-series -- --search "[Series Name]"` to enrich individual series when they unblock.

---

### 2. Reading Order Journeys (20 curated series) — STRATEGIC BLOCKER
**Status:** 18 of 20 complete — 2 hard blockers remain  
**Done when:** All 20 series pages live, each passing the quality bar: ≥3 collected editions with correct `comicvine_id` + `volumeNumber`, ≥2 UK retailers with live Vol. 1 price, valid synopsis, correct sort order.  
**Blocked by:** Naruto (complex 3-in-1/catalogue data mix, needs human triage) · Baki the Grappler (Kodama Tales English edition not yet indexed on ComicVine)  
**Quality bar:** Do NOT add any series where `volumeNumber` values are wrong or fewer than 2 retailers price Vol. 1.  
**Build order (all complete):** ~~Saga~~ ✓ → ~~Trigun Maximum Deluxe~~ ✓ → ~~Laid-Back Camp~~ ✓ → ~~Ouran OHSHC~~ ✓ → ~~Witch Hat Atelier~~ ✓ → ~~Hellsing~~ ✓ → ~~Void Rivals~~ ✓ → ~~Sengoku Youko~~ ✓ → ~~Under Ninja~~ ✓ → ~~Innocent Omnibus~~ ✓ → ~~Wolf's Daughter~~ ✓ → ~~Eden of Witches~~ ✓ → ~~Multi-Mind Mayhem~~ ✓ → ~~The Walking Dead~~ ✓ → ~~Fullmetal Alchemist~~ ✓ → ~~Invincible~~ ✓ → ~~Claymore~~ ✓ → ~~Overlord~~ ✓ | Naruto ⛔ BLOCKED | Baki the Grappler ⛔ BLOCKED  
**Progress:** In progress (17 of 20 series live — Naruto and Baki externally blocked, Claymore resolved via removal)

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
**Note:** Appears solid — verify on production before launch day. 2026-06-15: confirmed `/api/search?q=Saga` returns volume + issue results; "Did you mean" now suppressed when the query already has confident results (was surfacing irrelevant fuzzy matches like "Spawn" for "Saga"). Autocomplete dropdown remains intentionally series-level.

---

### 6. Product Pages
**Status:** Good (UX overhaul 2026-05-30, post-audit fixes 2026-06-05)  
**Done when:** Product pages load with correct cover, creators, synopsis, and pricing for enriched products. Fallback placeholder shown for unenriched. No console errors.  
**Note:** Best current area. Minor polish only.

---

### 7. Affiliate Tracking
**Status:** Good (eBay + Amazon + AWIN all operational; re-verified on production 2026-06-15)
**Done when:** `/go/[id]` redirect and click logging verified on production URL. No console errors.
**Verified (2026-06-15):** Amazon `/go/` appends `?tag=catchcomics-21` (1,282 priced Amazon UK listings); AWIN redirects to `awin1.com/cread.php` with `awinmid`, `awinaffid=2888331`, `clickref=cc-{listingId[:8]}`, clean `ued` (no double-wrap); Bookshop.org routes identically to Waterstones via AWIN (awinmid 62675); `click_events` writes confirmed live; eBay item URLs normalised to `ebay.co.uk` (US-link fix). Open (manual): confirm an AWIN click lands in the AWIN reporting dashboard.

---

### 8. Legal Pages + Disclosures
**Status:** Done (2026-06-07)  
**Done when:** ✓ Complete. Privacy Policy at `/privacy` (enhanced: AWIN, server logs, third-party processors, UK GDPR rights, international transfers, data retention, children). Affiliate Disclosure at `/affiliate-disclosure` (AWIN, Amazon Associates, eBay EPN status, ranking honesty, price accuracy, third-party retailer clarity). Shared SiteFooter on all pages. Minimal CookieNotice (no fake consent). Footer links: About · Affiliate Disclosure · Privacy · Terms. Build passing. Note: solicitor review recommended before full public launch — wording is transparent but not professionally certified.  
**Note:** Contact email is now hello@catchcomics.com across all public pages. Ensure that mailbox is live before public launch.

---

### 9. Series Index Page (`/series`)
**Status:** ✅ Done (2026-06-08)  
**Done when:** `/series` accessible from navbar. 17 series listed with cards. Browsable on mobile.  
**Delivered:**
- `/series` index page — hero, ISR 1h, responsive grid, JSON-LD, sitemap ✓ (pre-existing)
- Navbar "Series" link — desktop all pages, active state on `/series/*` ✓ (shipped 2026-06-08)
- MobileHeader "Series" link — homepage mobile discovery variant ✓ (shipped 2026-06-08)
- Homepage "Explore Series" section — 6 cards, mobile+desktop responsive, "Browse all series →" CTA ✓ (shipped 2026-06-08)
- A visitor can reach `/series` in one click from any page on the site.

---

### 10. Navbar + Homepage Discovery
**Status:** ✅ Done (2026-06-08)  
**Done when:** `/series` link in Navbar + "Explore Series" section on homepage.  
**Delivered:**
- `Navbar.tsx` — usePathname + "Series" link (between logo and search bar; hidden sm:block for narrow viewports; active state #E8272A on /series/*)
- `MobileHeader.tsx` — "Series" link added to discovery variant (homepage mobile header)
- `components/ExploreSeriesSection.tsx` (NEW) — 6 featured series cards, 3-col mobile / 6-col desktop, static OL fallback → live R2 covers from DB on mount
- `app/api/series-preview/route.ts` (NEW) — ISR route (1h) for featured series covers + counts
- `app/page.tsx` — imports and renders ExploreSeriesSection after all layout sections

---

### 11a. Analytics — Vercel Analytics
**Status:** ✅ Done (2026-06-08)  
**Launch-critical:** YES  
**Done when:** ✓ Complete. `@vercel/analytics` installed, `<Analytics />` added to `app/layout.tsx`. Build passes. Privacy policy updated to disclose Vercel Analytics (no cookies, no cross-site tracking).  
**Effort:** 15 min  
**Why:** Without analytics, you cannot validate whether the launch worked. No pageviews, no sessions, no conversion signals.

---

### 11b. Error Monitoring
**Status:** ✅ Done (2026-06-08)  
**Launch-critical:** YES (pre-launch)  
**Done when:** ✓ Complete. Vercel Observability Plus (enabled, 30-day retention) covers all server-side errors. Client-side error forwarding added: `app/error.tsx` sends browser crashes to `/api/log-error` which logs to Vercel server logs. No Sentry required — no third-party service, no cookies, no privacy implications. Build passes.  
**Effort:** 30 min  
**Why:** A broken series page could be live for days without visibility. Silent failures post-launch are unacceptable.  
**Where to see errors:**
- Dashboard: vercel.com → catch-comics-v2 → Logs tab (filter by Error)
- Observability: vercel.com → catch-comics-v2 → Observability tab → Functions → error rate
- CLI: `vercel logs --environment production --status-code 5xx --since 1h`
- CLI: `vercel logs --environment production --query "[client-error]" --since 24h`
- Inngest failures: inngest.com → your functions (also logged via on-failure.ts)
**What is NOT visible:** Only if Vercel itself goes down.

---


### 12a. AWIN_PUBLISHER_ID — Verify in Vercel Production
**Status:** ✅ Done (2026-06-08)  
**Launch-critical:** YES  
**Done when:** ✓ Complete. Confirmed via Vercel CLI (`vercel env ls`) + live production test. Production `/go/` redirects to `awin1.com/cread.php` with `awinmid`, `awinaffid` (7-digit publisher ID, matches local), `clickref=cc-{listingId[:8]}`, and clean `ued` (no double-wrap). HTTP 302. Attribution fully operational.  
**Effort:** 5 min  
**Risk:** If unset, `wrapAffiliateUrl()` falls through to unwrapped URLs. Silent revenue failure — only visible in server-side console logs.

---

### 12b. Claymore — Fix broken reading order
**Status:** ✅ Done (2026-06-08) — removed from registry (Option B)  
**Done when:** ✓ Claymore removed from `lib/series/registry.ts`. `/series/claymore` returns 404. Data integrity restored — no collector can encounter a broken "Start Here" badge pointing to Vol 2.  
**Restoration path:** Source Vol 1 evidence (retailer feed or Google Books) → insert canonical product row → confirm live pricing → re-add `claymore` to registry. See BACKLOG.md for full audit detail.

---

### 13. Vercel Production Env Vars + Inngest Sync
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
- **Full catalogue CV enrichment** — Running in background. Optimised 2026-06-08: rateMs 25s→20s, S0 Low Power Idle blocked, restart delay 30s→5s. ETA ~June 15 (continuous). Not gated on launch.
- **Character / Creator / Publisher Pages** — Post-launch, requires ~30–40% CV coverage

### Nice-to-have operational tasks (deferred, implementation complete)

- **Slack Alerting** — Add `SLACK_WEBHOOK_URL` to Vercel Production. Code is done. 5–10 min effort. Prevents silent degradation of background jobs post-launch. See item 13 above for full steps.
- ~~**Speed Insights**~~ — **Not recommended pre-launch.** $10/month per project + $0.65/10k data points. Not included in Pro plan (separate paid add-on). Adds no collector-facing value and doesn't improve search, discovery, or revenue. Vercel Analytics already covers pageviews and session data. Reconsider post-launch if Core Web Vitals become a specific concern.

---

## Completion by Area

| Area | Weight | Status | % done |
|---|---|---|---|
| CV Enrichment (launch series) | 10% | ✅ All 18 live series enriched. Bulk workers complete (30,585 IDs, 0 remaining, stopped 2026-06-10). | 100% |
| Reading Journeys | 20% | 17 live; 1 resolved via removal (Claymore); 2 blocked (Naruto, Baki) | 85% |
| Cleanup v2 | — | Done | 100% |
| AWIN write mode | — | Done | 100% |
| Search | 10% | Functional — price filter non-op is the only notable issue | 75% |
| Product Pages | 10% | Good — mobile creators hidden, no-retailer state needs guidance | 78% |
| Affiliate Tracking / Monetisation | 10% | AWIN working; eBay unwrapped; AWIN_PUBLISHER_ID verified ✅ | 75% |
| Legal Pages | 7% | Done — mailbox hello@catchcomics.com unverified | 88% |
| Discovery — Series Index + Navbar | 15% | ✅ Done — navbar + MobileHeader link + homepage Explore Series section | 90% |
| Analytics | 7% | ✅ Done — `@vercel/analytics` installed, `<Analytics />` in layout (2026-06-08) | 100% |
| Error Monitoring | 5% | ✅ Done — Vercel Observability Plus + client-side forwarding (2026-06-08) | 100% |
| Vercel Env Vars + Inngest | — | Done — DYNAMIC_LINK sync loop fixed 2026-06-08 (was ~960 failing invocations/day) | 100% |
| R2 Image Domain | — | Done | 100% |
| Slack Alerting | Post-launch | Deferred — code complete, webhook not yet created | — |
| Data quality — Claymore | 6% | ✅ Resolved — removed from registry 2026-06-08. No broken reading order. | 95% |

**Recalculated readiness: see dashboard** *(dashboard generator authoritative — last updated 2026-06-15)*  

*Note: the generator uses requirement-status weights (STRATEGIC BLOCKER×2, TACTICAL BLOCKER×1.5, standard×1), which differs from the session narrative (flat percentage weights). Generator output is authoritative.*

| Session | Gain |
|---------|------|
| Strategic review baseline | 62% |
| Discovery + Navbar + Homepage | +~12pp |
| Claymore resolved | +~3pp |
| Analytics installed | +~5pp |
| Error Monitoring installed | +~9pp |
| CV Enrichment complete + prod deploy (2026-06-15) | +~5pp |
| **Current (generator)** | **94%** |

*Remaining gaps: Reading Journeys 18/20 (2 blocked externally), Monetisation (eBay unwrapped), Legal (mailbox unverified), Smoke test in progress.*

**Open blockers (ranked by impact):**
1. ~~Discovery: no path from homepage or navbar to `/series`~~ ✅ DONE
2. ~~Analytics: no pageview data = cannot validate the launch~~ ✅ DONE — 2026-06-08
3. ~~Claymore: Vol 1 absent = broken reading order~~ ✅ DONE — 2026-06-08
4. ~~Error monitoring: production crashes invisible~~ ✅ DONE — 2026-06-08
5. ~~AWIN_PUBLISHER_ID: unverified in Vercel Production~~ ✅ DONE — 2026-06-08
6. ~~Production deployment: not on latest commit~~ ✅ DONE — 2026-06-15 (catchcomics.com · commit 5c34dd8)
7. **Production smoke test: IN PROGRESS (2026-06-15)** — running now
8. **Launch announcement copy: not written** — the launch IS the announcement
9. **hello@catchcomics.com mailbox: unverified** — 5 min, in Privacy Policy and Footer
10. Search price filter: non-functional UI misleads collectors (30 min fix)
11. Naruto: blocked (human triage required) · Baki: blocked (ComicVine indexing)

---

## Critical Path — Steps

1. ~~Cleanup v2 sign-off and execute~~ ✓ Done 2026-06-07
2. ~~Series list defined — 20 series named, scored, and verified~~ ✓ Done 2026-06-07 (see BACKLOG.md)
3. ~~Series pages Tier 1~~ ✓ Done 2026-06-08 — Saga, Trigun Maximum Deluxe, Laid-Back Camp, Ouran OHSHC, Witch Hat Atelier (all repaired and shipped)
4. ~~Series pages Tier 2~~ ✓ Done 2026-06-08 — Hellsing, Void Rivals, Sengoku Youko, Under Ninja
5. ~~Series pages Tier 3~~ ✓ Done 2026-06-08 — Innocent Omnibus, Wolf's Daughter, Eden of Witches, Multi-Mind Mayhem | **Naruto ⛔ BLOCKED** (needs human triage) | **Baki ⛔ BLOCKED** (needs ComicVine indexing)
6. ~~Series index page at /series~~ ✓ Done 2026-06-08
7. ~~Navbar update — add /series link~~ ✓ Done 2026-06-08
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
