-- Migration: 20260511200000_external_api_and_usage_log
--
-- 1. Adds EXTERNAL_API to the RetailerPlatform enum.
--    PostgreSQL enums can only ADD values (never remove/rename without a full
--    type rebuild), so we use the safe ADD VALUE approach.
--
-- 2. Creates the api_usage_log table for budget tracking of paid API calls
--    (Rainforest/Amazon, Bookshop.org).

-- ── 1. Extend RetailerPlatform enum ───────────────────────────────────────────

ALTER TYPE "RetailerPlatform" ADD VALUE IF NOT EXISTS 'EXTERNAL_API';

-- ── 2. Add isbn_13 and ean to retailer_listings ──────────────────────────────
-- Denormalised for fast querying ("find all unmatched listings with an ISBN").
-- Populated by adapters at upsert time.

ALTER TABLE "retailer_listings"
    ADD COLUMN IF NOT EXISTS "isbn_13" VARCHAR(13),
    ADD COLUMN IF NOT EXISTS "ean"     VARCHAR(13);

CREATE INDEX IF NOT EXISTS "retailer_listings_isbn_13_idx" ON "retailer_listings" ("isbn_13");

-- ── 3. Create api_usage_log ───────────────────────────────────────────────────

CREATE TABLE "api_usage_log" (
    "id"            UUID            NOT NULL DEFAULT gen_random_uuid(),
    "provider"      VARCHAR(50)     NOT NULL,
    "endpoint"      TEXT            NOT NULL,
    "isbn_13"       VARCHAR(13),
    "result_found"  BOOLEAN         NOT NULL,
    "latency_ms"    INTEGER         NOT NULL,
    "cost_estimate" DECIMAL(8,4),
    "called_at"     TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT "api_usage_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "api_usage_log_provider_called_at_idx"
    ON "api_usage_log" ("provider", "called_at" DESC);

CREATE INDEX "api_usage_log_isbn_13_idx"
    ON "api_usage_log" ("isbn_13");
