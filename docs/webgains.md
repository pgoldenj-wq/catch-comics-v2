# Webgains Notes

Publisher account: Catch Comics (catchcomics.com)
Applied: 2026-05-17
Account activation: up to 48 hours from application
Programme approvals: instant (auto) to 7 days (manual review per advertiser)

Webgains deeplink format:
`https://track.webgains.com/click.html?wgprogramid={PROGRAM_ID}&wgcampaignid={CAMPAIGN_ID}&wgtarget={ENCODED_URL}`

---

## Hive Books ⭐ Priority

Programme ID: **10671**
Commission: 4–8% tiered (volume-based)
Cookie: 30 days
Average basket: ~£18
Conversion rate: 5.15%
Product feed: 762,472 products (Google Shopping CSV/XML, updated daily)
ISBN URL pattern: `https://www.hive.co.uk/Product/Details/{ISBN13}` (unconfirmed — 403 on all bot fetches, verify in browser)
Contact: affiliates@hive.co.uk
Restrictions: No PPC on any engine. No voucher codes.

Status: Pending programme approval ⏳ (applied 2026-05-17)

Integration plan once approved:
1. `npm run seed:hive -- --write` — register retailer
2. `npm run create:hive -- --write` — create 4,863 DYNAMIC_LINK stubs
3. Build sync-webgains-feed.ts for full ISBN-matched feed ingestion (762K products)

Manual verification needed:
- Open `https://www.hive.co.uk/Product/Details/9781974758005` in browser to confirm ISBN URL pattern

---

## DC Thomson ⭐ Apply Next

Programme ID: TBD (search "DC Thomson" in Webgains advertiser directory)
Commission: 7%
Cookie: 30 days
Sells: Beano, Commando, Oor Wullie comics, magazine subscriptions, gifts
Catalogue: Comic-native — Beano is one of the UK's oldest comics brands
Status: Not yet applied ⏳

Action: Apply in Webgains dashboard → Advertiser Directory → "DC Thomson"

---

## Awesome Books

Programme ID: TBD
Commission: 6%
Cookie: 30 days
Catalogue: 461K+ products, 2.75M unique ISBNs (new + secondhand books)
Strong secondhand/discounted graphic novels and TPBs
Status: Not yet applied ⏳

---

## Eaglemoss Shop

Programme ID: TBD
Commission: 0–5%
Cookie: 90 days (excellent for retargeting)
Sells: Marvel, DC, Batman, Star Trek, Walking Dead collectibles and figurines
EPHC: Low (0.75% conversion) — collectibles are browse-heavy
Status: Not yet applied ⏳

---

## Books 4 People

Programme ID: TBD
Commission: 5%
Cookie: 30 days
Sells: Discounted book sets, up to 80% off RRP, AOV ~£30
Status: Low priority ⏳
