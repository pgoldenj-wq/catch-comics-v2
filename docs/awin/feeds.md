# AWIN Product Feeds — Reference

Publisher account: https://ui.awin.com/
Publisher ID: `2888331`
API Key: see `.env.local` → `AWIN_API_KEY`

Feed download base URL:
```
https://productdata.awin.com/datafeed/download/apikey/{AWIN_API_KEY}/language/en/fid/{FEED_ID}/columntypes/all/format/csv/delimiter/%2C/compression/none/
```

---

## Bookshop.org UK

| Field            | Value                        |
|------------------|------------------------------|
| Merchant name    | Bookshop.org UK              |
| Programme ID     | `62675`                      |
| Feed ID (FID)    | 99173    |
| Additional ISBN feed FID | 100002 |
| Feed format      | CSV                          |
| Feed language    | en                           |
| Currency         | GBP                          |
| Country          | UK                           |
| AWIN affiliate   | active                       |
| Merchant URL     | https://uk.bookshop.org      |

### Manual download URL
```
https://productdata.awin.com/datafeed/download/apikey/{AWIN_API_KEY}/language/en/fid/99173/columntypes/all/format/csv/delimiter/%2C/compression/none/
```

### Selected columns of interest
| Column name        | Notes                                      |
|--------------------|--------------------------------------------|
| `product_name`     | Title — use for stub title                 |
| `isbn`             | ISBN-13 — primary match key                |
| `price`            | Live price in GBP                          |
| `delivery_cost`    | Shipping cost                              |
| `stock_quantity`   | Use to derive StockStatus                  |
| `aw_deep_link`     | Pre-wrapped AWIN affiliate URL             |
| `product_url`      | Canonical product page URL                 |
| `image_url`        | Cover image                                |
| `category_name`    | e.g. "Books > Comics & Graphic Novels"     |
| `description`      | Product description (may be truncated)     |

### Ingestion notes
- Feed file saved to: `feeds/awin/bookshop-uk-{YYYY-MM-DD}.csv`
- Run ingestion via: `npm run test:awin-feed -- --feed-id {FID} --format csv`
- Full ingest (when ready): update `sync_config.feedId` on the `uk.bookshop.org` retailer record
- Match strategy: ISBN-13 → `canonical_products.isbn_13`
- Affiliate URL: use `aw_deep_link` from feed directly (already AWIN-wrapped)
- Stock: if `stock_quantity` is absent, default to `IN_STOCK` if price > 0

---

## Lets Buy Books

| Field            | Value                          |
|------------------|--------------------------------|
| Merchant name    | Lets Buy Books                 |
| Programme ID     | `122824`                       |
| Feed ID (FID)    | 112530      |
| Feed format      | CSV                            |
| Feed language    | en                             |
| Currency         | GBP                            |
| Country          | UK                             |
| AWIN affiliate   | active                         |
| Merchant URL     | https://www.letsbuybooks.com  |

### Manual download URL
```
https://productdata.awin.com/datafeed/download/apikey/{AWIN_API_KEY}/language/en/fid/112530/columntypes/all/format/csv/delimiter/%2C/compression/none/
```

### Selected columns of interest
| Column name        | Notes                                      |
|--------------------|--------------------------------------------|
| `product_name`     | Title                                      |
| `isbn`             | ISBN-13 — primary match key                |
| `price`            | Live price in GBP                          |
| `aw_deep_link`     | Pre-wrapped AWIN affiliate URL             |
| `product_url`      | Product page URL                           |
| `image_url`        | Cover image                                |
| `stock_quantity`   | Stock level                                |
| `category_name`    | Filter to comic categories                 |

### Ingestion notes
- Feed file saved to: `feeds/awin/letsbuybooks-{YYYY-MM-DD}.csv`
- Run ingestion via: `npm run test:awin-feed -- --feed-id {FID} --format csv`
- Match strategy: ISBN-13 → `canonical_products.isbn_13`
- Category filter: restrict to comics/graphic novels categories before upsert

---

## How to find Feed IDs (FIDs)

FIDs are **not** the same as Programme IDs. To find them:

1. Log in at https://ui.awin.com/
2. Go to **Toolbox → Product Feeds** (or **Data Feeds**)
3. Search for the merchant by name or programme ID
4. The FID is the numeric ID shown next to the feed name

Once found, paste the FID into the table above and into the download URL.

---

## Test ingestion command

```bash
# Dry-run — download and parse 100 rows, no DB writes
npm run test:awin-feed -- --feed-id {FID} --format csv --limit 100

# Full ingest (when ready)
npm run test:awin-feed -- --feed-id {FID} --format csv --write
```

---

## Feed file naming convention

```
feeds/awin/{merchant-slug}-{YYYY-MM-DD}.csv
feeds/awin/{merchant-slug}-{YYYY-MM-DD}.xml
```

Examples:
```
feeds/awin/bookshop-uk-2026-05-17.csv
feeds/awin/letsbuybooks-2026-05-17.csv
```

These files are gitignored (see root `.gitignore`). Only `.gitkeep` is committed.
