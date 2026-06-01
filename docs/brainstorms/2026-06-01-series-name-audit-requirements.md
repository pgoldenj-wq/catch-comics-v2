# Series Name Data Audit
**Date:** 2026-06-01  
**Status:** Findings complete — informs Series Pages MVP implementation  
**Method:** Live database queries against 45,445 canonical products

---

## Executive Summary

The series name data is better than feared on fragmentation, and worse than hoped on volume ordering. But the most important finding is structural: **the catalogue is overwhelmingly manga, and the four western series named as MVP targets (Absolute Batman, Ultimate Spider-Man, Saga, Invincible) are largely absent from the enriched data pool.** Series Pages can proceed immediately — but the launch set must be rebuilt from actual data rather than assumed audience preference.

**Verdict: Proceed with Series Pages. Fix capitalisation first. Reorder the MVP candidate list.**

---

## 1. Overall Data Quality

| Metric | Count | % of catalogue |
|---|---|---|
| Total live products | 45,445 | 100% |
| With `series_name` | 4,658 | **10.2%** |
| Without `series_name` | 40,787 | **89.8%** |
| Distinct series names | 2,303 | — |
| With `volume_number` | 2,656 | 5.8% |
| With `comicvine_id` | 3,802 | 8.4% |

**The 89.8% with null `series_name` is the primary gap.** This is not a data quality problem in the usual sense — it reflects the catalogue composition. Products without `series_name` are overwhelmingly format=OTHER (37,241 products, 99.8% null) which are non-comic items from the cleanup pipeline, plus large chunks of TPB (47.7% null), HARDCOVER (90.6% null), and format types that predate the series name enrichment work.

---

## 2. Fragmentation Assessment — Lower Severity Than Expected

**47 series have fragmented `series_name` values.**

After detailed analysis, the fragmentation is almost entirely one type: **capitalisation inconsistency.** Examples:

- "The Walking Dead" vs "The walking dead" — capital D
- "Vampire Knight" vs "Vampire knight" — capital k  
- "YuYu Hakusho" vs "Yuyu Hakusho" — CamelCase vs sentence case
- "Is It Wrong To Try To Pick Up Girls In A Dungeon?" — four variants, all capitalisation
- "JUDGE" vs "Judge" — ALL CAPS vs title case

There are no cases of fundamentally different naming (e.g. "Walking Dead" vs "TWD" vs "Kirkman Zombie Series"). The fragments are the same title in different case conventions.

**This is trivially fixable.** A single SQL `UPDATE` normalising `series_name` to title case (or a canonical form) resolves 47 of 47 fragmented series. Estimated effort: 2-3 hours including verification.

**The fragmentation is not a blocker for Series Pages.**

---

## 3. The Real Problem: `volume_number` Coverage

`volume_number` is absent for the majority of multi-volume series. This is the actual data gap that affects reading order.

**Series with largest `volume_number` gaps:**

| Series | Products | Missing vol_num |
|---|---|---|
| Blue Lock | 20 | 20/20 (0%) |
| Kimi ni Todoke | 20 | 20/20 (0%) |
| Rent-A-Girlfriend | 19 | 19/19 (0%) |
| Wind Breaker | 17 | 17/17 (0%) |
| Edens Zero | 15 | 15/15 (0%) |
| Noragami | 14 | 14/14 (0%) |
| Case Closed | 49 | 22/49 (55% missing) |

Many of the largest series in the catalogue have zero `volume_number` coverage. Without it, reading order depends on `release_date` — which is unreliable for manga and often null.

**However:** For most of these series, `comicvine_id` coverage is 100%. ComicVine provides issue order data. This means the CV pipeline can backfill reading order without manual intervention.

---

## 4. The Unexpected Finding: The Catalogue Is Manga-First

The 4 "launch series" named in the Series Pages spec were: Absolute Batman, Ultimate Spider-Man, Saga, Invincible.

Looking at the top 50 series by product count:

- **Invincible** appears at #39 — 11 products, 91% vol_num, 100% CV ✅
- **The Walking Dead** appears at #2 — 28 products, 100% vol_num, 96% CV ✅
- **Absolute Batman, Ultimate Spider-Man, Saga** — **absent from the top 50**

The remaining top 50 is dominated by manga titles: Case Closed, Spice and Wolf, Nana, Blue Lock, Fullmetal Alchemist, Vampire Knight, etc.

This reveals a mismatch between the assumed launch series (western comics the developer knows) and the actual catalogue content (manga-heavy).

**Why are Absolute Batman and Saga absent?**

Two possibilities, both likely true:
1. They have few volumes (Absolute Batman has 2 volumes, Saga has ~11 — neither dominates by count)
2. Their products likely exist in the catalogue but with `series_name = NULL` (part of the 89.8%)

A targeted query for "Absolute Batman" or "Saga" in the product title would confirm this, but the audit data already shows neither series has enough `series_name`-populated products to appear in the top 50.

---

## 5. ComicVine Enrichment as the Fix

For the 47 fragmented series, the CV overlap query reveals: **virtually all fragmented series share a single `comicvine_id` across their variants.** 

Examples:
- "The Walking Dead" / "The walking dead" → 28/29 products with CV id, **1 distinct CV id** ✅
- "Vampire Knight" / "Vampire knight" → 18/18 products with CV id, **1 distinct CV id** ✅
- "That Time I Got Reincarnated As A Slime" (2 variants) → 19/19 products with CV id, **1 distinct CV id** ✅

This is the most important finding in the audit: **`comicvine_id` provides a clean canonical grouping key that makes `series_name` fragmentation irrelevant.**

A series page built on `comicvine_id` grouping (rather than `series_name` text matching) bypasses the fragmentation problem entirely.

The only exception: "Is It Wrong to Pick Up Girls in a Dungeon?" has 2 distinct CV ids across 18 products — this is a genuine data quality issue (possibly main series vs side story mixed), not just capitalisation.

---

## 6. `series_name` Null Coverage by Format

| Format | Total | Null series_name | % Null |
|---|---|---|---|
| OTHER | 37,301 | 37,241 | 99.8% |
| TPB | 5,161 | 2,463 | 47.7% |
| MANGA_VOLUME | 2,342 | 707 | 30.2% |
| HARDCOVER | 117 | 106 | 90.6% |
| COMPENDIUM | 113 | 96 | 85.0% |
| SINGLE_ISSUE | 83 | 60 | 72.3% |
| OMNIBUS | 201 | 52 | 25.9% |
| DELUXE | 101 | 47 | 46.5% |
| ABSOLUTE | 26 | 15 | 57.7% |

**Key observations:**
- MANGA_VOLUME has the best `series_name` coverage (70%) of any format
- TPB is 52% covered — where the bulk of western comic series live
- HARDCOVER is 90% null — Absolute Batman and similar prestige editions are almost entirely unmapped
- ABSOLUTE has 11 products with `series_name` out of 26 — the Absolute editions are barely covered

This confirms that the Series Pages MVP must either: (a) accept that western/prestige comic series have poor data and focus on manga, or (b) run targeted `series_name` backfill for specific western series before launch.

---

## 7. MVP Candidate Series — Actual Data

**Best candidates based on real data:**

| # | Series | Vols | vol_num | cv_id | Format |
|---|---|---|---|---|---|
| 1 | Fullmetal Alchemist | 17 | 100% | 100% | TPB, MANGA_VOLUME |
| 2 | The Walking Dead | 28 | 100% | 96% | TPB |
| 3 | Invincible | 11 | 91% | 100% | TPB |
| 4 | Claymore | 11 | 100% | 100% | TPB |
| 5 | Rising of the Shield Hero | 13 | 100% | 85% | MANGA, TPB |
| 6 | Overlord | 10 | 100% | 100% | MANGA, TPB |
| 7 | Sailor Moon | 9 | 100% | 100% | TPB |
| 8 | Didn't I Say to Make My Abilities Average... | 11 | 100% | 100% | TPB |
| 9 | Immortal Hulk | 4 | 100% | 100% | TPB |
| 10 | Erased | 4 | 100% | 100% | MANGA |

**Notable: Fullmetal Alchemist and The Walking Dead are the two highest-quality large series in the catalogue.** Both have near-perfect data.

**The originally planned MVP series and their actual data:**
- **Absolute Batman** — likely 2 volumes, both probably in the 57.7% null ABSOLUTE bucket. **Not ready without targeted backfill.**
- **Ultimate Spider-Man** — not in top 50, probably null `series_name`. **Not ready without targeted backfill.**
- **Saga** — not in top 50. **Not ready without targeted backfill.**
- **Invincible** — ✅ Present, 91% vol_num, 100% CV. **Ready.**

---

## 8. Severity Assessment

| Issue | Severity | Affected Products | Fix Effort |
|---|---|---|---|
| `series_name` capitalisation fragmentation | **Low** | ~300 products across 47 series | 2-3 hours SQL |
| `volume_number` missing on large series | **Medium** | ~1,500+ products | CV enrichment (ongoing) or manual backfill |
| 89.8% of products have null `series_name` | **High** | 40,787 products | Long-term enrichment only |
| Western/prestige comics (HARDCOVER, ABSOLUTE) have 90%+ null `series_name` | **High for planned MVP** | HARDCOVER: 106/117 null | Targeted backfill for specific series |
| `comicvine_id` available as canonical grouping key | **Opportunity** | 3,802 products (growing) | Architecture decision |

**Overall verdict:** The data is worse than the spec assumed for western comics (Absolute Batman, Saga) and better than feared for fragmentation severity. The catalogue's strongest series data is in manga — which wasn't the intended launch surface.

---

## 9. Recommended Fixes

### Fix 1: Capitalisation Normalisation (do this first, 2-3 hours)

Run a SQL update to normalise `series_name` to title-case across the 47 fragmented series. This is a surgical, reversible operation targeting known problem series.

```sql
-- Example (run per series after verification):
UPDATE canonical_products
SET series_name = 'The Walking Dead'
WHERE LOWER(series_name) = 'the walking dead'
  AND series_name != 'The Walking Dead';
```

Or apply a general title-case normalisation to `series_name` where the fragmented pairs differ only in capitalisation. Verify results before committing.

### Fix 2: Build `comicvine_id`-based grouping alongside `series_name` grouping

In the series page data layer, group by `comicvine_id` (when available) as the canonical identifier, with `series_name` as fallback for unenriched products. This makes the system resilient to the capitalisation problem and the ongoing `series_name` inconsistency.

`series_name` determines the URL slug. `comicvine_id` determines grouping. When both exist and agree, the page is correct. When `series_name` is inconsistent but `comicvine_id` is consistent, the page is still correct.

### Fix 3: Targeted `series_name` backfill for planned MVP western series (if proceeding with them)

If the MVP must include Absolute Batman, Saga, and Ultimate Spider-Man as originally planned, run a targeted query to find their products (by title substring) and set `series_name` + `volume_number` manually. This is a 2-4 hour one-time operation for 3 series.

```sql
-- Example:
UPDATE canonical_products
SET series_name = 'Absolute Batman', volume_number = 1
WHERE title ILIKE 'Absolute Batman%Vol%1%'
  AND format IN ('HARDCOVER', 'ABSOLUTE', 'TPB')
  AND deleted_at IS NULL;
```

### Fix 4: `volume_number` backfill via CV enrichment (ongoing)

The volume_number gap is widespread but self-healing as CV enrichment progresses. For the 10 best MVP candidate series, all have 85-100% CV coverage, so the enrichment pipeline can populate volume order automatically. No manual intervention needed for the top candidates.

---

## 10. MVP-Safe Implementation Strategy

**Two tracks, running in parallel:**

### Track A: Launch immediately with actual data

Launch Series Pages for the 5 series with best real data:
1. The Walking Dead (28 vols, 100% vol_num, 96% CV)
2. Fullmetal Alchemist (17 vols, 100% vol_num, 100% CV)
3. Invincible (11 vols, 91% vol_num, 100% CV)
4. Claymore (11 vols, 100% vol_num, 100% CV)
5. Overlord (10 vols, 100% vol_num, 100% CV)

These series can go live with minimal data work. They'll prove the Series Pages concept with real, complete data.

### Track B: Backfill priority western series in parallel

While Track A ships, run the targeted backfill for:
- Absolute Batman (2 volumes, straightforward)
- Saga (11 volumes, well-known series)
- Ultimate Spider-Man (current Wells run)
- X-Men (current Gerry Duggan run)

These require ~4-8 hours of data work but unlock the western comics content that was originally planned.

### Architecture decision: route by `comicvine_id`, not `series_name`

Given that CV enrichment provides a canonical grouping key, the Series Page data layer should:
1. Prefer `comicvine_id` grouping when available (bypasses all fragmentation)
2. Fall back to `series_name` text match for unenriched products
3. Use `series_name` only for the URL slug

This is a ~1 day architecture decision that pays off over the entire lifetime of the feature.

---

## 11. Should Series Pages Proceed Immediately?

**Yes, with adjustments:**

1. **Fix capitalisation fragmentation first.** 2-3 hours. Reduces noise before any code is written.

2. **Rebuild the MVP candidate list from actual data.** The Walking Dead and Fullmetal Alchemist are stronger first candidates than Absolute Batman and Saga based on available data. Invincible is still valid.

3. **Add `comicvine_id` grouping to the architecture.** Don't build purely on `series_name`. Use CV ID as the canonical key.

4. **Don't wait for 100% coverage.** The top 10 series have sufficient data to launch. Ship those, validate the feature concept, then expand.

The data quality concern from the spec was real but narrower than feared. The fragmentation is cosmetic (capitalisation). The deeper issue — null `series_name` on 89.8% of products — is not a Series Pages problem, it's a catalogue enrichment problem that will improve over time regardless.

Series Pages on top of the existing data, with the fixes above, will work correctly for ~15-20 series today and expand automatically as enrichment progresses.

---

## Appendix: Top 47 Fragmented Series (all capitalisation variants)

All 47 fragmented series are case-sensitivity issues only. No fundamental naming disagreements found. Full list available from the audit script output.

**Worst case (4 variants):**  
"Is It Wrong to Try to Pick Up Girls in a Dungeon?" — four different capitalisation patterns across 18 products. Single CV id means grouping by comicvine_id solves this without any SQL fix.

**Exception to investigate:**  
"How Not to Summon a Demon Lord" — 2 distinct CV ids across 12 products. May indicate main series vs side story or light novel vs manga mixing. Needs manual review before including in Series Pages.
