-- Enable pg_trgm for fuzzy title matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN index on canonical_products for FTS (title + series_name + publisher)
CREATE INDEX IF NOT EXISTS idx_canonical_products_fts
  ON canonical_products
  USING GIN (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || coalesce(series_name, '') || ' ' || coalesce(publisher, '')
    )
  );

-- GIN trigram index on canonical_products.title for similarity() queries
CREATE INDEX IF NOT EXISTS idx_canonical_products_title_trgm
  ON canonical_products
  USING GIN (title gin_trgm_ops);

-- GIN trigram index on canonical_products.series_name
CREATE INDEX IF NOT EXISTS idx_canonical_products_series_trgm
  ON canonical_products
  USING GIN (series_name gin_trgm_ops)
  WHERE series_name IS NOT NULL;

-- GIN index on retailer_listings.title for unmatched listing search (Query B)
CREATE INDEX IF NOT EXISTS idx_retailer_listings_title_fts
  ON retailer_listings
  USING GIN (to_tsvector('english', title));

-- GIN trigram index on retailer_listings.title
CREATE INDEX IF NOT EXISTS idx_retailer_listings_title_trgm
  ON retailer_listings
  USING GIN (title gin_trgm_ops);

-- Partial index for unmatched listings (canonical_product_id IS NULL) — makes Query B fast
CREATE INDEX IF NOT EXISTS idx_retailer_listings_unmatched
  ON retailer_listings (retailer_id)
  WHERE canonical_product_id IS NULL;