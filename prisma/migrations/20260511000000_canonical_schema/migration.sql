-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 20260511000000_canonical_schema
-- Catch Comics — canonical product model + multi-retailer price tracking
--
-- Creates four tables:
--   canonical_products   — deduplicated real-world product records
--   retailers            — stores and data sources
--   retailer_listings    — one row per product per retailer
--   price_history        — append-only price change log
--
-- Postgres 15+ recommended (gen_random_uuid() built-in, no extension needed).
-- For Postgres 12-14, uncomment the pgcrypto line below.
-- ─────────────────────────────────────────────────────────────────────────────

-- CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- needed only on Postgres < 13


-- ── Enum types ────────────────────────────────────────────────────────────────

CREATE TYPE "ProductFormat" AS ENUM (
  'SINGLE_ISSUE',
  'TPB',           -- Trade Paperback / collected softcover
  'HARDCOVER',
  'OMNIBUS',
  'DELUXE',
  'COMPENDIUM',
  'MANGA_VOLUME',
  'ABSOLUTE',      -- DC Absolute / prestige oversized editions
  'OTHER'
);

CREATE TYPE "RetailerPlatform" AS ENUM (
  'EBAY',
  'SHOPIFY',
  'BIGCOMMERCE',
  'WOOCOMMERCE',
  'AWIN_FEED',     -- Awin affiliate product feed
  'CJ_FEED',       -- Commission Junction feed
  'MANUAL'         -- Hand-entered records
);

CREATE TYPE "ListingCondition" AS ENUM (
  'NEW',
  'LIKE_NEW',
  'VERY_GOOD',
  'GOOD',
  'ACCEPTABLE',
  'POOR',
  'UNGRADED',      -- No condition stated in the original listing
  'GRADED'         -- Slabbed / professionally graded (see condition_detail)
);

CREATE TYPE "StockStatus" AS ENUM (
  'IN_STOCK',
  'LOW_STOCK',
  'OUT_OF_STOCK',
  'PREORDER',
  'UNKNOWN'
);

CREATE TYPE "MatchMethod" AS ENUM (
  'ISBN',          -- ISBN-13 exact match
  'EAN',           -- EAN / barcode exact match
  'COMICVINE_ID',  -- Comic Vine volume or issue id
  'FUZZY_TITLE',   -- Normalised title similarity (Levenshtein / trigram)
  'MANUAL',        -- Human-reviewed and confirmed
  'UNMATCHED'      -- Not yet matched to a canonical product
);


-- ── canonical_products ────────────────────────────────────────────────────────
-- One row per real-world product. retailer_listings rows point here once matched.
-- isbn_13 uses a PARTIAL unique index so multiple NULLs are allowed without
-- violating uniqueness — this is important for products without an ISBN.

CREATE TABLE "canonical_products" (
  "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
  -- ISBN-13 stored without hyphens, e.g. "9781779507099"
  "isbn_13"         VARCHAR(13),
  -- ISBN-10 stored without hyphens (legacy; not enforced unique)
  "isbn_10"         VARCHAR(10),
  -- EAN / GTIN-13 barcode
  "ean"             VARCHAR(13),
  -- Comic Vine numeric volume/issue ID stored as text (avoids int overflow edge cases)
  "comicvine_id"    TEXT,
  "title"           TEXT         NOT NULL,
  "subtitle"        TEXT,
  "publisher"       TEXT,
  "format"          "ProductFormat" NOT NULL,
  -- Parent series name, e.g. "Absolute Batman" for a specific issue
  "series_name"     TEXT,
  -- Volume number within the series (integer)
  "volume_number"   INTEGER,
  -- Issue identifier as text to handle "1", "1A", "Annual 1", "#0", etc.
  "issue_number"    TEXT,
  "release_date"    DATE,
  "cover_image_url" TEXT,
  "description"     TEXT,
  -- URL slug, globally unique, e.g. "absolute-batman-vol-1-the-zoo"
  "canonical_slug"  TEXT         NOT NULL,
  "created_at"      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updated_at"      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT "canonical_products_pkey" PRIMARY KEY ("id")
);

-- Partial unique on isbn_13: enforces uniqueness only when the value is
-- present. PostgreSQL's standard UNIQUE already allows multiple NULLs, but
-- this explicit partial index is self-documenting and future-proof.
CREATE UNIQUE INDEX "canonical_products_isbn_13_unique"
  ON "canonical_products" ("isbn_13")
  WHERE "isbn_13" IS NOT NULL;

CREATE UNIQUE INDEX "canonical_products_canonical_slug_key"
  ON "canonical_products" ("canonical_slug");

-- Lookup indexes
CREATE INDEX "canonical_products_isbn_13_idx"      ON "canonical_products" ("isbn_13");
CREATE INDEX "canonical_products_isbn_10_idx"      ON "canonical_products" ("isbn_10");
CREATE INDEX "canonical_products_ean_idx"          ON "canonical_products" ("ean");
CREATE INDEX "canonical_products_comicvine_id_idx" ON "canonical_products" ("comicvine_id");
CREATE INDEX "canonical_products_publisher_idx"    ON "canonical_products" ("publisher");
CREATE INDEX "canonical_products_series_name_idx"  ON "canonical_products" ("series_name");

-- updated_at trigger
CREATE OR REPLACE FUNCTION _catch_comics_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER "canonical_products_updated_at"
  BEFORE UPDATE ON "canonical_products"
  FOR EACH ROW EXECUTE FUNCTION _catch_comics_set_updated_at();


-- ── retailers ─────────────────────────────────────────────────────────────────
-- One row per (platform × country) combination.
-- eBay UK and eBay US are separate rows with the same platform value.

CREATE TABLE "retailers" (
  "id"                UUID             NOT NULL DEFAULT gen_random_uuid(),
  "name"              TEXT             NOT NULL,
  -- Bare domain, e.g. "ebay.co.uk", "forbiddenplanet.com"
  "domain"            TEXT             NOT NULL,
  "platform"          "RetailerPlatform" NOT NULL,
  -- ISO 3166-1 alpha-2, e.g. "GB", "US"
  "country_code"      CHAR(2)          NOT NULL,
  -- ISO 4217, e.g. "GBP", "USD"
  "currency"          CHAR(3)          NOT NULL,
  "is_active"         BOOLEAN          NOT NULL DEFAULT TRUE,
  -- 0–100. Higher = more trusted price data.
  "trust_score"       SMALLINT         NOT NULL DEFAULT 50,
  "affiliate_network" TEXT,
  "affiliate_id"      TEXT,
  "last_synced_at"    TIMESTAMPTZ,
  -- Platform-specific config: API endpoints, credentials references, category IDs.
  -- Never store raw secrets here — reference vault/env keys by name only.
  "sync_config"       JSONB            NOT NULL DEFAULT '{}',
  "created_at"        TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  "updated_at"        TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

  CONSTRAINT "retailers_pkey"              PRIMARY KEY ("id"),
  CONSTRAINT "retailers_trust_score_range" CHECK ("trust_score" BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX "retailers_domain_key" ON "retailers" ("domain");

CREATE TRIGGER "retailers_updated_at"
  BEFORE UPDATE ON "retailers"
  FOR EACH ROW EXECUTE FUNCTION _catch_comics_set_updated_at();


-- ── retailer_listings ─────────────────────────────────────────────────────────
-- One row per product per retailer. canonical_product_id is nullable because
-- freshly ingested listings are unmatched until the matching pipeline runs.
--
-- ON DELETE behaviour:
--   canonical_product → SET NULL  (listing survives, just unmatched)
--   retailer          → RESTRICT  (prevent orphaned listings)

CREATE TABLE "retailer_listings" (
  "id"                   UUID               NOT NULL DEFAULT gen_random_uuid(),
  -- NULL until matched by the product-matching pipeline
  "canonical_product_id" UUID,
  "retailer_id"          UUID               NOT NULL,
  -- The retailer's own stable identifier (eBay itemId, Shopify product id, etc.)
  "retailer_sku"         TEXT               NOT NULL,
  "retailer_url"         TEXT               NOT NULL,
  -- Original title exactly as returned by the retailer — not normalised
  "title"                TEXT               NOT NULL,
  "price_amount"         NUMERIC(10, 2)     NOT NULL,
  -- ISO 4217, e.g. "GBP", "USD"
  "price_currency"       CHAR(3)            NOT NULL,
  "shipping_amount"      NUMERIC(10, 2),
  "condition"            "ListingCondition" NOT NULL,
  -- Free text for graded copies, e.g. "CGC 9.8", "PGX 8.0 — White Pages"
  "condition_detail"     TEXT,
  "stock_status"         "StockStatus"      NOT NULL DEFAULT 'UNKNOWN',
  "image_url"            TEXT,
  -- Full raw API / feed response preserved for debugging and re-matching
  "raw_data"             JSONB              NOT NULL DEFAULT '{}',
  -- 0–100 confidence in the canonical product match
  "match_confidence"     SMALLINT           NOT NULL DEFAULT 0,
  "match_method"         "MatchMethod"      NOT NULL DEFAULT 'UNMATCHED',
  "first_seen_at"        TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  "last_seen_at"         TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  "last_price_change_at" TIMESTAMPTZ,

  CONSTRAINT "retailer_listings_pkey"
    PRIMARY KEY ("id"),
  CONSTRAINT "retailer_listings_retailer_sku_unique"
    UNIQUE ("retailer_id", "retailer_sku"),
  CONSTRAINT "retailer_listings_match_confidence_range"
    CHECK ("match_confidence" BETWEEN 0 AND 100),
  CONSTRAINT "retailer_listings_canonical_product_fk"
    FOREIGN KEY ("canonical_product_id")
    REFERENCES "canonical_products" ("id")
    ON DELETE SET NULL,
  CONSTRAINT "retailer_listings_retailer_fk"
    FOREIGN KEY ("retailer_id")
    REFERENCES "retailers" ("id")
    ON DELETE RESTRICT
);

CREATE INDEX "retailer_listings_canonical_product_id_idx"
  ON "retailer_listings" ("canonical_product_id");

CREATE INDEX "retailer_listings_retailer_id_idx"
  ON "retailer_listings" ("retailer_id");

-- Covering index for the cheapest-price query:
--   SELECT * FROM retailer_listings
--   WHERE canonical_product_id = $1
--   ORDER BY price_amount ASC
CREATE INDEX "retailer_listings_product_price_idx"
  ON "retailer_listings" ("canonical_product_id", "price_amount");


-- ── price_history ─────────────────────────────────────────────────────────────
-- APPEND ONLY. Never UPDATE or DELETE rows.
-- Insert a new row each time a listing's price or stock status changes.
-- Enables price-trend charts, deal alerts, and historical lowest-price queries.
--
-- ON DELETE CASCADE from retailer_listings: if a listing is removed (rare),
-- its history is removed too. Consider archiving instead of hard-deleting
-- listings in production.

CREATE TABLE "price_history" (
  "id"                  UUID          NOT NULL DEFAULT gen_random_uuid(),
  "retailer_listing_id" UUID          NOT NULL,
  "price_amount"        NUMERIC(10, 2) NOT NULL,
  -- ISO 4217
  "price_currency"      CHAR(3)       NOT NULL,
  "stock_status"        "StockStatus" NOT NULL,
  "recorded_at"         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT "price_history_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "price_history_retailer_listing_fk"
    FOREIGN KEY ("retailer_listing_id")
    REFERENCES "retailer_listings" ("id")
    ON DELETE CASCADE
);

-- Composite index for time-range queries on a specific listing
CREATE INDEX "price_history_listing_recorded_idx"
  ON "price_history" ("retailer_listing_id", "recorded_at" DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED: initial retailer rows for eBay UK and eBay US
-- These are the only active data sources at launch.
-- Add Forbidden Planet, Amazon, etc. here when their sync pipelines are ready.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "retailers"
  ("name", "domain", "platform", "country_code", "currency", "is_active",
   "trust_score", "affiliate_network", "affiliate_id", "sync_config")
VALUES
  (
    'eBay UK',
    'ebay.co.uk',
    'EBAY',
    'GB',
    'GBP',
    TRUE,
    75,
    NULL,
    NULL,
    '{"marketplace_id": "EBAY_GB", "category_id": "259104", "default_limit": 40}'
  ),
  (
    'eBay US',
    'ebay.com',
    'EBAY',
    'US',
    'USD',
    TRUE,
    75,
    NULL,
    NULL,
    '{"marketplace_id": "EBAY_US", "category_id": "259104", "default_limit": 40}'
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- BACKFILL PLAN — migrating existing eBay data into this schema
-- (no code yet — this is the implementation roadmap)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- STEP 1 — Create canonical products from Comic Vine results
-- ──────────────────────────────────────────────────────────
-- The current /api/search endpoint returns Comic Vine volume/issue records.
-- Each result that reaches the detail page (/comic/[id]) should become a
-- canonical_products row:
--
--   INSERT INTO canonical_products (
--     comicvine_id, title, publisher, format, series_name,
--     volume_number, issue_number, release_date, cover_image_url,
--     canonical_slug
--   ) VALUES (
--     <cv.id>, <cv.name>, <cv.publisher.name>, <mapped_format>,
--     <cv.volume.name>, <cv.volume_number>, <cv.issue_number>,
--     <cv.cover_date>, <cv.image.medium_url>,
--     <slugify(cv.name + '-' + cv.start_year)>
--   )
--   ON CONFLICT (canonical_slug) DO NOTHING;
--
-- Format mapping from detectFormat() in search/page.tsx:
--   'single-issue'  → SINGLE_ISSUE
--   'graphic-novel' → TPB
--   'hardcover'     → HARDCOVER
--   'omnibus'       → OMNIBUS
--   'manga'         → MANGA_VOLUME
--   'compact'       → TPB
--   'one-shot'      → SINGLE_ISSUE
--
--
-- STEP 2 — Snapshot current eBay listings into retailer_listings
-- ──────────────────────────────────────────────────────────────
-- The current /api/prices and /api/price-hint routes call searchListings()
-- which returns EbayListing[] from lib/ebay.ts. Each listing should be
-- upserted into retailer_listings:
--
--   INSERT INTO retailer_listings (
--     canonical_product_id, retailer_id, retailer_sku, retailer_url,
--     title, price_amount, price_currency, condition,
--     stock_status, image_url, raw_data,
--     match_confidence, match_method
--   ) VALUES (
--     <canonical_products.id via comicvine_id lookup>,
--     <retailers.id WHERE domain = 'ebay.co.uk' (or 'ebay.com')>,
--     <ebayListing.itemId>,
--     <ebayListing.itemWebUrl>,
--     <ebayListing.title>,
--     <ebayListing.price.value>,
--     <ebayListing.price.currency>,
--     <mapped_condition>,  -- see note below
--     'IN_STOCK',
--     <ebayListing.imageUrl>,
--     <json(ebayListing)>,
--     85,                  -- eBay + Comics category = reasonably high confidence
--     'FUZZY_TITLE'        -- no ISBN in eBay listings yet
--   )
--   ON CONFLICT (retailer_id, retailer_sku) DO UPDATE SET
--     price_amount = EXCLUDED.price_amount,
--     last_seen_at = NOW(),
--     last_price_change_at = CASE
--       WHEN retailer_listings.price_amount <> EXCLUDED.price_amount THEN NOW()
--       ELSE retailer_listings.last_price_change_at
--     END;
--
-- Condition mapping (eBay condition string → ListingCondition enum):
--   'New'         → NEW
--   'Like New'    → LIKE_NEW
--   'Very Good'   → VERY_GOOD
--   'Good'        → GOOD
--   'Acceptable'  → ACCEPTABLE
--   'For parts'   → POOR
--   ''/'Unknown'  → UNGRADED
--   contains 'CGC'/'PGX'/'CBCS' → GRADED (set condition_detail to raw string)
--
--
-- STEP 3 — Write price_history snapshot from retailer_listings
-- ────────────────────────────────────────────────────────────
-- Once retailer_listings is populated, insert one history row per listing:
--
--   INSERT INTO price_history (retailer_listing_id, price_amount, price_currency, stock_status)
--   SELECT id, price_amount, price_currency, stock_status
--   FROM retailer_listings;
--
-- Subsequent price changes are written by the sync worker (Step 4) — not here.
--
--
-- STEP 4 — Replace /api/prices with a DB-backed route
-- ───────────────────────────────────────────────────
-- Once the schema is populated, /api/prices can become:
--
--   1. Look up canonical_products WHERE comicvine_id = :id (or by slug)
--   2. SELECT rl.*, r.name AS retailer_name
--      FROM retailer_listings rl
--      JOIN retailers r ON r.id = rl.retailer_id
--      WHERE rl.canonical_product_id = :canonical_id
--        AND r.country_code = :country_code
--        AND rl.stock_status != 'OUT_OF_STOCK'
--      ORDER BY rl.price_amount ASC
--      LIMIT 20;
--   3. Cache result in pricesCache (unchanged from current behaviour)
--
-- The live eBay query (searchListings) becomes a background sync job that
-- runs every 4–6 hours per (canonical_product, region) pair, writing new
-- rows into price_history and updating retailer_listings in place.
--
--
-- STEP 5 — ISBN enrichment pass
-- ─────────────────────────────
-- OpenLibrary / Google Books APIs can return ISBN-13 for many titles.
-- Run a one-off enrichment after Step 1:
--
--   For each canonical_products row WHERE isbn_13 IS NULL:
--     1. Call Open Library /search.json?title=<title>&fields=isbn
--     2. If a high-confidence ISBN is returned, UPDATE canonical_products
--        SET isbn_13 = <isbn> WHERE id = <id>
--
-- Once ISBNs are populated, match_method on future retailer_listings rows
-- can be 'ISBN' instead of 'FUZZY_TITLE', and match_confidence raised to 98+.
-- ─────────────────────────────────────────────────────────────────────────────
