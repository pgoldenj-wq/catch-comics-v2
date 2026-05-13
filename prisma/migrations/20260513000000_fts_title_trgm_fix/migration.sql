-- Forward-only fix: create the two GIN trigram indexes on title columns
-- that were missing after 20260511141232_fts_indexes was applied.
-- Both use IF NOT EXISTS — safe to run even if they already exist.

-- Ensure pg_trgm is available (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index on canonical_products.title for similarity() queries
CREATE INDEX IF NOT EXISTS idx_canonical_products_title_trgm
  ON canonical_products
  USING GIN (title gin_trgm_ops);

-- GIN trigram index on retailer_listings.title
CREATE INDEX IF NOT EXISTS idx_retailer_listings_title_trgm
  ON retailer_listings
  USING GIN (title gin_trgm_ops);
