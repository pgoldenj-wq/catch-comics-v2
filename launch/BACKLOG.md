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
| 3 | Witch Hat Atelier | Kodansha | 10 | 2 | 100% | 76.0 | Build — Tier 1 |
| 4 | The Walking Dead | Image Comics | 27 | 1* | 100% | 75.8 | ✅ DONE |
| 5 | Invincible | Image Comics | 11 | 1* | 100% | 73.0 | ✅ DONE |
| 6 | Laid-Back Camp | Yen Press | 3 | 2 | 100% | 72.3 | Build — Tier 1 |
| 7 | Trigun Maximum Deluxe Edition | Dark Horse Comics | 5 | 2 | 100% | 71.5 | Build — Tier 1 |
| 8 | Ouran High School Host Club | Viz Media | 16 | 2 | 100% | 71.0 | Build — Tier 1 |
| 9 | Hellsing | Dark Horse Comics | 10 | 2 | 100% | 69.3 | Build — Tier 2 |
| 10 | Naruto | Viz Media | 6 | 2 | 100% | 68.8 | Build — Tier 2 ⚠️ |
| 11 | Overlord | Yen On | 10 | 1* | 100% | 65.8 | ✅ DONE |
| 12 | Sengoku Youko | Tokyopop | 3 | 2 | 100% | 63.5 | Build — Tier 2 |
| 13 | Void Rivals | Image Comics | 4 | 2 | 100% | 61.5 | Build — Tier 2 |
| 14 | Under Ninja | DENPA | 3 | 2 | 100% | 56.0 | Build — Tier 3 |
| 15 | Innocent Omnibus | Dark Horse Comics | 3 | 2 | 100% | 55.8 | Build — Tier 3 |
| 16 | Claymore | Viz Media | 11 | 0* | 100% | 55.5 | ✅ DONE |
| 17 | Eden of Witches | Abrams, Inc. | 4 | 2 | 100% | 53.5 | Build — Tier 3 |
| 18 | Wolf's Daughter: A Werewolf's Tale | Seven Seas | 3 | 2 | 100% | 52.8 | Build — Tier 3 |
| 19 | Multi-Mind Mayhem | One Peace Books | 3 | 2 | 100% | 52.0 | Build — Tier 3 |
| 20 | Baki the Grappler | Kodama Tales | 6 | 2 | 0% | 51.5 | Build — Tier 3 ⚠️ |

\* Failed gate but already built. Built manually — not DB-gate dependent.

### Score breakdowns — Tier 1 (build first)

| Series | Search (25%) | UK coverage (25%) | Beginner (20%) | Adaptation (15%) | DB+CV (15%) | Total |
|--------|-------------|-------------------|----------------|------------------|-------------|-------|
| Saga | 95 | 75 | 85 | 40 | 100 | **80.5** |
| Witch Hat Atelier | 72 | 75 | 80 | 55 | 100 | **76.0** |
| Laid-Back Camp | 55 | 75 | 90 | 65 | 80 | **72.3** |
| Trigun Maximum Deluxe | 60 | 75 | 65 | 65 | 100 | **71.5** |
| Ouran High School Host Club | 65 | 75 | 75 | 40 | 100 | **71.0** |

### Data quality flags

**⚠️ Naruto (rank 10):** `distinct_volumes = 1` despite 6 editions in DB. All 6 editions appear to be Vol.1 formats (standard, omnibus, box set). Investigate before building series page — if only Vol.1 is represented, the page would show a 72-volume series with only 1 entry. Fix: check `canonical_products` for `series_name = 'Naruto'`, confirm `volume_number` values, run `ingest-cv-series` if needed.

**⚠️ Baki the Grappler (rank 20):** `cv_enriched_editions = 0`. No ComicVine IDs assigned. Cover images and synopsis will be missing. Fix: run `npm run ingest:cv-series -- --search "Baki the Grappler"` before building series page.

**✅ Vol.1 prices resolved (2026-06-07):** Query bug fixed — `MIN(rl.price_amount)` now guards `AND rl.price_amount > 0` to exclude DYNAMIC_LINK stubs (intentional £0.00 affiliate links). All 19 passing series have real Vol.1 prices confirmed in DB. Saga Vol.1 confirmed at £7.49 (Travelling Man). No data corruption — the gate was always correct.

### Not recommended at launch (too low score or blocking data issue)

| Series | Score | Reason |
|--------|-------|--------|
| Ascender | 52.3 | Requires reading Descender first — not beginner-friendly |
| I Want to Love You Till Your Dying Day | 42.8 | `distinct_volumes = 1`, low cultural reach |
| Tsugumi Project | 40.8 | `distinct_volumes = 1`, very niche |
| A Man Who Defies the World of BL | 39.0 | No CV enrichment, very niche |

### Recommended next 4 series pages to build (Saga done)

1. ~~**Saga** — Score 80.5. ✅ DONE 2026-06-07.~~ 11 volumes, all R2 covers, 2 retailers on Vol.1 at £7.49. Note: vols 7 and 10 absent from DB (data gap, not a page blocker).
2. **Witch Hat Atelier** — Score 76.0. Anime adaptation announced. Critically acclaimed. 6 distinct volumes, 10 editions, 100% enriched. Strong beginner entry. **Build next.**
3. **Ouran High School Host Club** — Score 71.0. Highest edition count of any passing series (16 editions, 4 volumes). Page will be richest in the catalogue. Well-loved shojo — appeals to a different audience than Saga.
4. **Trigun Maximum Deluxe Edition** — Score 71.5. 2023 Trigun Stampede anime reignited interest. 5 distinct volumes, 100% enriched. Clean series page.
5. **Laid-Back Camp** — Score 72.3. Netflix presence. Extremely beginner-friendly (highest beginner score in the set). Wholesome aesthetic stands out in the catalogue.

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
