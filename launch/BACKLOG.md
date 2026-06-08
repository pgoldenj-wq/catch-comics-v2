# Catch Comics — Backlog

Items here are real, intentionally deferred from the current week.  
Nothing here is forgotten. Nothing here is in scope until WEEK.md has capacity.  
Format: `[Area] Item — Launch-critical: yes/no`

---

## Launch Series — Ranked List (Defined 2026-06-07)

**Query run:** `scripts/series-candidates.ts` against production DB  
**Gate criteria:** ≥3 collected editions, Vol.1 exists, ≥2 UK retailers pricing Vol.1, not deleted, valid formats (TPB/HARDCOVER/OMNIBUS/MANGA_VOLUME/ABSOLUTE/COMPENDIUM/DELUXE)  
**Scoring model:** Search demand 25% · UK retailer coverage 25% · Beginner friendliness 20% · Adaptation boost 15% · DB+CV readiness 15%  
**Result:** 591 series with ≥3 editions; 19 pass the full gate; 5 already done; 15 to build → **20 launch series total**

### Series pages — complete ranked table

| Rank | Series | Publisher | Editions | Vol.1 retailers | CV % | Score | Status |
|------|--------|-----------|----------|-----------------|------|-------|--------|
| 1 | Saga | Image Comics | 11 | 2 | 100% | 80.5 | ✅ DONE (2026-06-07) |
| 2 | Fullmetal Alchemist | Viz Media | 18 | 1* | 100% | 77.0 | ✅ DONE |
| 3 | Witch Hat Atelier | Kodansha | 10 | 2 | 100% | 76.0 | ⚠ BLOCKED — vols 2,5,6,7,8 absent from DB |
| 4 | The Walking Dead | Image Comics | 27 | 1* | 100% | 75.8 | ✅ DONE |
| 5 | Invincible | Image Comics | 11 | 1* | 100% | 73.0 | ✅ DONE |
| 6 | Laid-Back Camp | Yen Press | 17 | 2 | 100% | 72.3 | ✅ DONE (2026-06-08) |
| 7 | Trigun Maximum Deluxe Edition | Dark Horse Comics | 5 | 2 | 100% | 71.5 | ✅ DONE (2026-06-07) |
| 8 | Ouran High School Host Club | Viz Media | 18 | 2 | 100% | 71.0 | ⚠ BLOCKED — vols 6-13 unidentifiable (OL, Google Books needed) |
| 9 | Hellsing | Dark Horse Comics | 10 | 2 | 100% | 69.3 | Build — Tier 2 |
| 10 | Naruto | Viz Media | 6 | 2 | 100% | 68.8 | Build — Tier 2 ⚠️ |
| 11 | Overlord | Yen On | 10 | 1* | 100% | 65.8 | ✅ DONE |
| 12 | Sengoku Youko | Tokyopop | 3 | 2 | 100% | 63.5 | ✅ DONE (2026-06-08) |
| 13 | Void Rivals | Image Comics | 4 | 2 | 100% | 61.5 | ✅ DONE (2026-06-08) |
| 14 | Under Ninja | DENPA | 3 | 2 | 100% | 56.0 | ✅ DONE (2026-06-08) |
| 15 | Innocent Omnibus | Dark Horse Comics | 3 | 2 | 100% | 55.8 | ✅ DONE (2026-06-08) |
| 16 | Claymore | Viz Media | 11 | 0* | 100% | 55.5 | ✅ DONE |
| 17 | Eden of Witches | Abrams, Inc. | 4 | 2 | 100% | 53.5 | ✅ DONE (2026-06-08) |
| 18 | Wolf's Daughter: A Werewolf's Tale | Seven Seas | 3 | 2 | 100% | 52.8 | ✅ DONE (2026-06-08) |
| 19 | Multi-Mind Mayhem | One Peace Books | 3 | 2 | 100% | 52.0 | ✅ DONE (2026-06-08) |
| 20 | Baki the Grappler | Kodama Tales | 6 | 2 | 0% | 51.5 | ⛔ BLOCKED — Kodama Tales English ed. not yet in ComicVine |

\* Failed gate but already built. Built manually — not DB-gate dependent.

### Score breakdowns — Tier 1 (build first)

| Series | Search (25%) | UK coverage (25%) | Beginner (20%) | Adaptation (15%) | DB+CV (15%) | Total |
|--------|-------------|-------------------|----------------|------------------|-------------|-------|
| Saga | 95 | 75 | 85 | 40 | 100 | **80.5** |
| Witch Hat Atelier | 72 | 75 | 80 | 55 | 100 | **76.0** |
| Laid-Back Camp | 55 | 75 | 90 | 65 | 80 | **72.3** |
| Trigun Maximum Deluxe | 60 | 75 | 65 | 65 | 100 | **71.5** |
| Ouran High School Host Club | 65 | 75 | 75 | 40 | 100 | **71.0** |

### Data quality flags — OPEN ISSUES

**⛔ Claymore (rank 16) — BROKEN READING ORDER (discovered 2026-06-08 strategic review)**
- Vol 1 (ISBN 9781421500897, Viz Media 2006) is absent from DB. Series page at `/series/claymore` shows Vol 2 as "Start Here" — a broken reading order.
- 16 of 27 volumes missing from DB (present: 2,3,4,5,7,10,14,15,17,26,27).
- Zero live retailer pricing across all 11 volumes in DB.
- The series is listed as DONE in the build order but delivers a broken experience.
- **Resolution options:**
  - Option A: Source Vol 1 ISBN, insert into DB, verify live pricing → 1–2 hrs. Then assess whether to build or defer remaining volumes.
  - Option B: Remove `claymore` from `lib/series/registry.ts` until Vol 1 can be properly sourced → 2 min.
- **Decision needed from operator** before launch.



**✅ Witch Hat Atelier (rank 3):** DONE 2026-06-08. Vols 2,5,6,7,8 sourced via Google Books (Kodansha ISBNs), inserted with covers. Vol.1 format fixed TPB→MANGA_VOLUME. Grimoire/supplemental editions set to DELUXE+NULL vol_number. All 14 vols present.

**✅ Ouran High School Host Club (rank 8):** DONE 2026-06-08. 10 bare-titled products unblocked via retailer listing evidence (retailer bb626f10 held complete titles). Vol 7 absent from DB; found via Google Books ISBN search (9781421508641, sequential between vol 6 and vol 8). All 18 vols present.

**⛔ Naruto (rank 10):** BLOCKED — deep catalogue problem. 81 products with cv=NULL (mostly 3-in-1 omnibus editions). Main series cv:18836 has only 6 products linked, 5 of them with volume_number=NULL. The 3-in-1 editions and individual volumes are mixed without clear CV ID linkage. Would require catalogue-wide enrichment run + editorial decision on which edition to feature. Cannot be resolved with targeted repair approach. **Needs human triage.**

**⛔ Baki the Grappler (rank 20):** BLOCKED — Kodama Tales English edition (pub Oct 2025) has no ComicVine volume entry yet. 20 volumes in DB with covers + pricing, but cv=NULL across all products (cv:146173 on vols 7-10 is the Spanish Meian edition — wrong publisher, cannot use). Series page query requires comicvine_id match. **Resolution: wait for ComicVine to index the Kodama Tales edition, then run targeted repair script.**

**⚠️ Baki the Grappler (rank 20):** `cv_enriched_editions = 0`. No ComicVine IDs assigned. Cover images and synopsis will be missing. Fix: run `npm run ingest:cv-series -- --search "Baki the Grappler"` before building series page.

**✅ Vol.1 prices resolved (2026-06-07):** Query bug fixed — `MIN(rl.price_amount)` now guards `AND rl.price_amount > 0` to exclude DYNAMIC_LINK stubs (intentional £0.00 affiliate links). All 19 passing series have real Vol.1 prices confirmed in DB. Saga Vol.1 confirmed at £7.49 (Travelling Man). No data corruption — the gate was always correct.

### Not recommended at launch (too low score or blocking data issue)

| Series | Score | Reason |
|--------|-------|--------|
| Ascender | 52.3 | Requires reading Descender first — not beginner-friendly |
| I Want to Love You Till Your Dying Day | 42.8 | `distinct_volumes = 1`, low cultural reach |
| Tsugumi Project | 40.8 | `distinct_volumes = 1`, very niche |
| A Man Who Defies the World of BL | 39.0 | No CV enrichment, very niche |

### Status (updated 2026-06-08 session 2)

**All 18 buildable series shipped. 2 hard blockers remain.**

Shipped this session (10 new pages):
- ~~**Ouran High School Host Club**~~ ✅ DONE 2026-06-08. 18 vols, retailer listing evidence + Google Books.
- ~~**Witch Hat Atelier**~~ ✅ DONE 2026-06-08. 14 vols incl. 5 newly sourced from Kodansha.
- ~~**Hellsing**~~ ✅ DONE 2026-06-08. 10 vols (Vol 8 bare title fixed).
- ~~**Void Rivals**~~ ✅ DONE 2026-06-08. 5 vols.
- ~~**Sengoku Youko**~~ ✅ DONE 2026-06-08. 6 vols (Vol 5 added from Google Books).
- ~~**Under Ninja**~~ ✅ DONE 2026-06-08. 8 vols (Vols 5 & 6 added from Google Books).
- ~~**Innocent Omnibus**~~ ✅ DONE 2026-06-08. 3 vols. Fixed: Innocent Rouge CV ID corrected 157999→171481.
- ~~**Wolf's Daughter**~~ ✅ DONE 2026-06-08. 4 vols (Vol 2 volume_number fixed).
- ~~**Eden of Witches**~~ ✅ DONE 2026-06-08. 7 vols (Vol 7 vol_number+format fixed; Vols 5-7 CV IDs set).
- ~~**Multi-Mind Mayhem**~~ ✅ DONE 2026-06-08. 3 vols.

**Remaining hard blockers (need human action):**
- **Naruto** — catalogue triage required (81 cv=NULL products, 3-in-1/individual mix)
- **Baki the Grappler** — wait for ComicVine to index Kodama Tales English edition (pub Oct 2025)

**Recommended next (after this session):** Series Index page at `/series` + Navbar link — the last 0% required item for launch.

---

## Series Failing the DB Gate — Aspirational (previously on next-up list)

These series were on the aspirational build list but failed the qualification gate. Root causes listed. Do not build until gate is cleared.

| Series | Issue | What's needed |
|--------|-------|---------------|
| Watchmen | Fewer than 3 editions in DB | Collect standard TPB + Deluxe + Absolute editions, verify UK retailer coverage on each |
| Sandman | Fewer than 3 editions OR vol1_uk_retailers < 2 | Same as Watchmen — needs all editions collected and retailer sync |
| Y: The Last Man | Fewer than 3 editions in DB | Collect all editions; check if Vertigo/DC listing is in AWIN feeds |
| Preacher | Fewer than 3 editions in DB | Same — Vertigo/DC coverage in AWIN may be thin |
| V for Vendetta | Single-volume work — can't reach ≥3 editions | Relaxed gate needed (single-vol landmark works) OR count all format editions |
| The Boys | Fewer than 3 editions in DB | Wildstorm/Dynamite/DC — check AWIN retailer coverage |
| Locke & Key | Fewer than 3 editions in DB | IDW — check AWIN coverage |
| Berserk | Not in DB with volume numbers | Run `ingest-cv-series`, verify volume_number values assigned |
| Akira | Not in DB with volume numbers | Same — Dark Horse editions need volume number data |
| Vagabond | Not in DB with volume numbers | Same — Viz editions need volume number data |
| Attack on Titan | Not in top 591 — may have <3 editions OR volume numbers missing | Check `series_name` variants; may need `ingest-cv-series` |
| Batman (Snyder run) | Not in DB as series with ≥3 editions | DC/Warner — AWIN coverage thin; complex arc naming |
| Dark Knight Returns | Single-volume work | Same issue as V for Vendetta — relaxed gate needed |
| All-Star Superman | Single-volume work | Same |

**Pattern:** Most Western comics from DC/Vertigo, IDW, and Dynamite are thin in the DB. AWIN feeds for these publishers appear to have limited UK retailer coverage. Series pages for these titles should be targeted for month 2 after improving DB coverage.

---

## Launch-critical — infrastructure items

- [Enrichment] Run `ingest-cv-series` for each of the 15 build-target series — Launch-critical: yes
- [Reading Orders] Build 15 series pages in tier order (see ranked table above) — Launch-critical: yes
- [Reading Orders] Build /series index page — Launch-critical: yes
- [UX/UI] Add /series link to navbar — Launch-critical: yes
- [Enrichment] Cover backfill after cleanup v2 — Launch-critical: yes

---

## Launch week 2 — build immediately after launch

- [Collections] Build collection page: Essential Batman — Launch-critical: no
- [Collections] Build collection page: Where to Start with Image Comics — Launch-critical: no
- [Collections] Build collection page: Scott Snyder's Batman Arc — Launch-critical: no
- [Collections] Build collection page: Essential Vertigo — Launch-critical: no
- [Collections] Build collection page: Best Horror Comics — Launch-critical: no
- [Collections] Build /collections index page — Launch-critical: no
- [UX/UI] Homepage redesign — surface Series and Collections — Launch-critical: no
- [Reading Orders] Investigate and clear DB gate for: Watchmen, Sandman, Attack on Titan, Berserk — for month 2 expansion

---

## Post-launch — after real user feedback

- [Reading Orders] Expand series 20 → 50+ (demand-driven) — Launch-critical: no
- [Collections] Expand collections 5 → 15–20 (engagement-driven) — Launch-critical: no
- [Collections] Collections Registry 2.0 / admin UI — Launch-critical: no
- [Monetisation] Price alerts — Launch-critical: no
- [Monetisation] Wishlist / collection tracking — Launch-critical: no
- [Monetisation] User identity / accounts — Launch-critical: no
- [SEO] SEO infrastructure pass (needs post-launch data) — Launch-critical: no
- [Discovery] Character Pages MVP (needs ~30–40% CV enrichment) — Launch-critical: no
- [Discovery] Creator Pages MVP — Launch-critical: no
- [Discovery] Publisher Pages — Launch-critical: no
- [Discovery] Aggregate interest signals — Launch-critical: no
- [Retailers] Bookshop.org covers (permanent 403 without CDN creds) — Launch-critical: no
- [UX/UI] Performance audit / Lighthouse pass — Launch-critical: no

---

## Decisions locked — not revisiting before launch

- Collection Pages: LAUNCH WEEK 2 (not day one — build with user signal)
- Reading order model: Model A (20 curated series, not auto-generated)
- Homepage: minimal change only (add /series to navbar)
- Character/Creator pages: gated on ~30–40% CV coverage — post-launch
- Community features: after utility is proven
- Mission control dashboard: GitHub Projects board is the visual system
- Launch series list: 20 series, DB-gate verified on 2026-06-07 — not reopening criteria
