# AWIN Notes

Publisher ID (Catch Comics): **2888331**

Deep-link structure (all merchants):
```
https://www.awin1.com/cread.php?awinmid={MERCHANT_ID}&awinaffid=2888331&clickref={CLICK_REF}&ued={ENCODED_DESTINATION_URL}
```
`clickref` format: `cc-{first 8 chars of listing UUID}` — matches click_events.listing_id in AWIN reports.

---

## Bookshop.org UK

Merchant ID: **62675**
Integration: Feed (FID 99173) + AWIN deep-link
Feed URL: `https://productdata.awin.com/datafeed/download/apikey/{KEY}/language/en/fid/99173/columntypes/all/format/csv/...`
Product URL pattern: `https://uk.bookshop.org/p/books/{slug}/{id}?ean={ISBN}`

Example deep-link:
```
https://www.awin1.com/cread.php?awinmid=62675&awinaffid=2888331&clickref=cc-3f7a9b2e&ued=https%3A%2F%2Fuk.bookshop.org%2Fp%2Fbooks%2Fsga-tp-1%2F5351121
```

Commission: ~5-8% (varies)
Status: Active ✓ | Feed FID 99173 active (ingested 2026-05-17)

---

## Wordery

Merchant ID: **9111**
Integration: AWIN deep-link only (no feed; scraped via Playwright)
Product URL pattern: `https://wordery.com/{title-slug}/{ISBN13}`

Commission: ~5% (varies)
Status: Active ✓ | 822 priced listings (2026-05-17)

---

## Waterstones

Merchant ID: **3787** (confirmed from aw_deep_link m= in downloaded feed; 2079 was incorrect)
Integration: DIRECT_AFFILIATE — bare `waterstones.com/book/{ISBN13}` stored in DB, AWIN-wrapped at `/go/` redirect time
Product URL pattern: `https://www.waterstones.com/book/{ISBN13}` (ISBN-direct, no slug needed)

Commission: 2-5%
Status: Active ✓ | Feed FID 3787 | affiliateId=3787 | 15,775 priced listings (2026-06-07)
Note: AWIN approval confirmed — feed downloaded 228,622 rows. DB updated with affiliateNetwork=awin, affiliateId=3787.

---

## LetsBuyBooks

Merchant ID: **122824** (affiliate ID) | Feed ID: **112530**
Integration: Feed (FID 112530) — AWIN_FEED platform
Status: Active ✓ | 5,870 priced listings (2026-06-07) | affiliateId=122824

---

## SpeedyHen

Merchant ID: **likely #7017** — confirm in AWIN publisher dashboard (search "SpeedyHen")
Integration: DYNAMIC_LINK candidate — `/book/{ISBN13}` pattern most likely (unconfirmed, ClaudeBot blocked)
Catalogue: Broad ISBN book catalogue via Gardners/Bertrams wholesaler — manga, graphic novels, TPBs confirmed
Commission: TBD

**Manual verification required before integration:**
1. Open `https://www.speedyhen.com/book/9781974758005` in a browser — confirm it loads a product page
2. Log into AWIN publisher dashboard → Advertiser Directory → search "SpeedyHen" → confirm merchant ID + programme status
3. If `/book/{ISBN13}` resolves: run `npm run seed:retailer` (create speedyhen.com record) then `npm run create:dynamic -- --domain speedyhen.com --url-template "https://www.speedyhen.com/book/{ISBN13}" --write`

Status: Pending manual verification ⏳