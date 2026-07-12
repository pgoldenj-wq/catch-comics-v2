# Trust & Data Quality Review

**Verdict: MOSTLY TRUSTWORTHY WITH KNOWN GAPS** — *conditional on the launch blockers landing.*
The distinguishing finding of this audit: **the data layer rarely lies; the copy and client-side labels sometimes do.** Fix the words and the two labelling bugs, and the honest-engineering already in the stack carries the launch.

All numbers from read-only queries on 2026-07-12 (`scripts/audit-launch-readiness-stats.ts`, kept in repo as the repeatable health check).

---

## 1. Are products accurate enough? — YES, with labelled thinness

- 81,832 live products, 99.9% ISBN-13-backed (book-trade feed provenance — identity is strong).
- **Format:** only 14.2% have a real format; 85.8% are `OTHER`, displayed as generic "Comic". Honest, not wrong.
- **Known wrong data (small, visible, fixable):**
  - "Absolute Flash Volume 1" shows publisher **Penguin Random House NZ** (distributor-as-publisher) — visible on the flagship search query in prod.
  - `cv_match_suspect` backlog: Absolute Green Lantern / Flash / Martian Manhunter wrong-volume CV matches (war-room record); AB Vol 2 carries a free-text suspect note about wrong `comicvine_id 2839` credits.
  - Near-duplicate editions surface side-by-side in search (two AB Vol 1 ISBNs, two Vol 3 ISBNs) with no differentiator.
- **Suspect-flag hygiene:** `cv_match_suspect` has 4 flagged rows and mixed types (boolean *and* prose). It's a notepad, not a system. Standardise to `{suspect: true, reason, flaggedAt}` and exclude suspect rows from creators/synopsis display.
- **Client label integrity:** the search page re-derives format from title keywords and gets flagships wrong (LB-2). The DB is right; the UI second-guesses it.

## 2. Are prices accurate enough? — YES for tracked retailers; NO for title-keyed eBay hints

**Tracked listings (the OffersTable):** genuinely solid.
- Freshness: of 48,805 priced listings — 17.7% <7d, 80.4% 7–30d, **only 1.9% >30d**. WoB feed synced today.
- Staleness handling: >30d rows grey at 50% + "(stale)"; 2–29d rows show "Checked Nd ago"; hero price only renders if fresh + in-stock (`showHeroPrice`, product page).
- Stock display deliberately removed after the 89%-false-OOS incident — the right trust call, documented in code.
- Sort is commission-blind (pure price asc). eBay rows carry postage caveat + commission disclosure. `/go` redirect validates, logs after response, wraps affiliate honestly.
- **Gap:** Amazon UK's 321 listings last synced 26 Jun → all cross the stale line ~launch day (LB-8).

**The comparison-depth truth:**
| Priced retailers per product | Products |
|---|---|
| 1 | 37,659 (99.76%) |
| 2 | 89 |
| 3 | 1 |

World of Books alone is 87.5% of priced listings. **On almost every page, "price comparison" = one WoB price + live eBay rows + un-priced "More retailers" links.** eBay rows are real comparison — but the marketing register ("world's only price comparison", "every price") writes cheques this table can't cash. Fix direction: honest copy now (LB-1), second priced retailer next (Wordery/Bookshop adapters exist; both currently at 0 priced listings — likely just keys/runs away from live).

**Title-keyed eBay "From £X" hints (search page):** currently untrustworthy — wrong-product anchors observed in prod (LB-3). Suppress or ISBN-key.

**"Deals":** no reference-price logic exists anywhere; anything labelled a deal is just a price (LB-7). The static fallback's "-N%" against hardcoded RRPs is the only fabricated-discount surface in the product — remove it.

## 3. Are images accurate enough? — YES; the pipeline learned its lessons

- The Cover Zero purge (placeholder detection by content hash, R2 ≠ valid) is encoded in the live system: homepage requires `images.catchcomics.com` covers; all four surfaces share `isBadCoverUrl`/`adjustImgSrc`; naturalWidth≤1 catches 1×1 GIFs; next/image restricted to allowlisted hosts (the AWIN-URL crash is un-repeatable).
- Live prod: 48/49 flagship search results render real R2 covers; product hero renders R2 via next/image.
- Wrong-cover risk: low. R2 covers are product-keyed UUIDs from a verified pipeline; CV fallback uses the product's own verified CV id (CC-027 pattern).
- **Watch items:** 22 hotlinked `comicvine.gamespot.com` images per product page (issue grid) returned 0×0 in my session — needs one human verification on real devices; OL hotlinks ×3,485 in DB (known backlog); 64% coverless catalogue is honest but thin.

## 4. Is database→UI trust robust? — YES

- Right fields read everywhere checked; fallbacks ordered DB → verified-CV → designed placeholder; nulls render as honest empty states ("No description available", "Check Availability", "Not enough price history yet (1/7 data points)").
- Soft-deletes respected in every query inspected (product, offers, /go, sitemap, homepage-deals).
- Placeholder regressions guarded at write (enrichment guard) and read (URL filter + pixel check).
- **Missing:** monitoring. No scheduled job tracks coverage/staleness/suspect counts over time. `scripts/audit-launch-readiness-stats.ts` (added by this audit, read-only) is the seed — run weekly, diff against last run.

---

## The one-sentence summary for the founder

Your engineering is more honest than your marketing. Ship the copy fixes and the two label fixes, and Catch Comics genuinely deserves the trust it asks for; skip them, and the first sharp-eyed collector on Reddit will find "world's only", a mislabelled Absolute Batman single, and a £5.95 hardcover anchor — and write the review you can't delete.
