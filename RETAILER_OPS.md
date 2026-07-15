# Retailer Operations State

Last updated: 2026-05-20

## Legend
- ✅ LIVE — commission actively earning
- ⚠️ PENDING — links redirect correctly but zero commission yet
- ❌ BROKEN / INACTIVE — not earning, links may fail
- 🔧 ACTION REQUIRED — something to do

---

## Retailers

### Travelling Man (travellingman.com)
- **DB listings**: ~9,239 priced
- **Commission**: ❌ None — no public affiliate programme
- **Feed**: Scraper (internal sync script)
- **Action**: 🔧 Email them directly re: direct affiliate arrangement
- **Notes**: Primary data anchor for comparison pages

### World of Books UK (worldofbooks.com)
- **DB listings**: ~43,677 priced (used books)
- **Commission**: ❌ REJECTED on AWIN
- **AWIN mid**: Unknown — rejected
- **Action**: 🔧 Re-apply via AWIN Rejected tab (+ Join button visible)
- **Notes**: Largest single source — zero revenue. Re-apply is 1 click.

### Wordery (wordery.com)
- **DB listings**: ~1,710 priced
- **Commission**: ❌ DEAD — AWIN merchant programme closed (mid=9111 defunct)
- **Affiliate config**: Patched to null (bare URLs, no AWIN redirect)
- **Action**: None — merchant is gone. Monitor for re-launch.

### Waterstones (waterstones.com)
- **DB listings**: ~4,863 (stubs)
- **Commission**: ⚠️ PENDING AWIN approval (mid=3787)
- **AWIN mid**: 3787 (not yet approved; mid=2079 is confirmed closed)
- **Links**: Redirect correctly via /go/ — just no commission yet
- **Action**: Monitor AWIN Pending tab. Chase if >4 weeks.

### Zavvi (zavvi.com)
- **DB listings**: ~4,904 (stubs)
- **Commission**: ⚠️ PENDING AWIN approval (mid=2549)
- **Links**: Redirect correctly via /go/
- **Action**: Monitor AWIN Pending tab.

### Bookshop.org UK (uk.bookshop.org)
- **DB listings**: 63 priced
- **Commission**: ✅ LIVE — AWIN mid=62675 (JOINED, confirmed working via curl)
- **Feed**: FID 99173 (product feed available) — NOT YET INGESTED AT SCALE
- **Action**: 🔧 Fix AWIN_DATAFEED_KEY in .env.local, then run:
  ```
  npm run sync:awin -- --merchant bookshop --write
  ```
- **Notes**: Second-most actionable retailer after WoB. Feed ingestion = easy 10k+ new listings.

### Lets Buy Books (letsbuybooks.com)
- **DB listings**: Small (not yet enriched)
- **Commission**: ✅ LIVE — AWIN mid=122824 (JOINED, confirmed working via curl)
- **Feed**: FID 112530 (product feed available)
- **Action**: 🔧 Fix datafeed key, then run:
  ```
  npm run sync:awin -- --merchant letsbuybooks --write
  ```

### Amazon UK (amazon.co.uk)
- **DB listings**: 321 priced (stored; last observed 20–26 Jun 2026; age out honestly under the 30-day rule)
- **Commission**: ✅ LIVE — Associates tag `catchcomics-21` (applied at /go click time)
- **Feed**: ❌ NONE — Rainforest RETIRED 2026-07-13 (account closed). `npm run enrich:amazon` now refuses with an explanation. Do not restore Rainforest or add any paid Amazon API without founder approval.
- **Status**: AFFILIATE-ONLY / STORED OFFERS — check with `npm run amazon:status`.
- **Future**: Amazon Creators API when eligible (10 qualifying sales in trailing 30 days) — see `launch/operations/amazon-post-rainforest-plan.md`. Also investigate the Awin "Amazon Sellers Programme UK" feed (JOINED).

### Amazon US (amazon.com)
- **DB listings**: None
- **Commission**: ❌ BUG — NEXT_PUBLIC_AMAZON_US_ASSOCIATE_TAG was set to `catchcomics-21` (UK tag). Blanked locally 2026-07-13; **founder: blank it in Vercel too**. Do not invent a US tag — untagged US links are correct until a real US Associates tag exists.

### eBay (ebay.co.uk)
- **DB listings**: Dynamic (API)
- **Commission**: ✅ LIVE — EPN campid=5339151767
- **wrapEpn()**: Applied at mapListing() time — all links pre-wrapped
- **Action**: Add `rel="sponsored"` to eBay links in OffersTable.tsx + EbaySection.tsx

### AbeBooks (abebooks.co.uk)
- **DB listings**: Stubs only (no priced)
- **Commission**: ❌ AWIN mid=6139 — PENDING approval
- **Action**: Monitor AWIN Pending tab. No priced listings anyway.

### WHSmith (whsmith.co.uk)
- **DB listings**: Stubs only
- **Commission**: ❌ TopCashback only — not viable for publisher affiliate
- **Action**: None viable.

### MusicMagpie (musicmagpie.co.uk)
- **DB listings**: None yet
- **Commission**: ⚠️ PENDING AWIN approval — EPC £0.26, conversion 11.88% (best in pending)
- **Action**: 🔧 Chase AWIN approval. Seed script needed when approved.

### Forbidden Planet (forbiddenplanet.com)
- **DB listings**: Stubs only
- **Commission**: ❓ NEXT_PUBLIC_FORBIDDEN_PLANET_AFFILIATE_CODE set — unverified
- **Action**: Manual test the /go/ redirect. Confirm commission structure.

---

## Action Queue (priority order)

1. **Fix AWIN_DATAFEED_KEY** — AWIN dashboard → Account → Data Feeds → copy key → .env.local
2. **Re-apply World of Books AWIN** — 1 click in Rejected tab (43,677 listings at stake)
3. **Run Bookshop feed** — `npm run sync:awin -- --merchant bookshop --write`
4. **Run Lets Buy Books feed** — `npm run sync:awin -- --merchant letsbuybooks --write`
5. ~~**Run Amazon enrichment**~~ — RETIRED 2026-07-13 (Rainforest gone; Amazon is affiliate-only until Creators API eligibility)
6. **Chase MusicMagpie AWIN** — email AWIN account manager
7. **Fix Amazon US tag bug** — blanked in .env.local 2026-07-13; still to blank in Vercel env vars
8. **Email Travelling Man** — direct affiliate arrangement
9. **Add rel="sponsored"** to eBay links
10. **Investigate Amazon Sellers Programme UK feed** — AWIN JOINED + product feed YES

---

## Key Env Vars

| Var | Where used | Status |
|---|---|---|
| `AWIN_DATAFEED_KEY` | sync-awin-feed.ts | ⚠️ May be wrong — getting 400 |
| `AWIN_PUBLISHER_ID` | lib/affiliate.ts | Set: 2888331 |
| ~~`RAINFOREST_API_KEY`~~ | (no references — code removed) | RETIRED 2026-07-13; never re-add |
| `NEXT_PUBLIC_AMAZON_UK_ASSOCIATE_TAG` | lib/amazon.ts callers | Set: catchcomics-21 |
| `NEXT_PUBLIC_AMAZON_US_ASSOCIATE_TAG` | lib/amazon.ts callers | Blank locally (was UK tag by mistake); blank in Vercel too |
| `EBAY_CAMPAIGN_ID` | lib/ebay.ts | Set: 5339151767 |
| `NEXT_PUBLIC_FORBIDDEN_PLANET_AFFILIATE_CODE` | PricingPanel.tsx | Set — unverified |
| `DATABASE_URL` | lib/prisma.ts | Set |
