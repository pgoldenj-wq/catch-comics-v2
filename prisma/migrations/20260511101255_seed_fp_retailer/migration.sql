-- ── Seed: Forbidden Planet retailer record ────────────────────────────────────
--
-- Platform: DIRECT_AFFILIATE
--   FP runs their own programme at forbiddenplanet.com/affiliates/.
--   No network intermediary (confirmed NOT Awin, NOT CJ).
--
-- is_active = FALSE
--   No sync pipeline exists. This record registers the domain and platform
--   classification only. The frontend surfaces a search deep-link fallback;
--   no price or stock data is shown.
--
-- Upgrade path (do not build speculatively):
--   1. Apply for FP's affiliate programme → obtain affiliate code.
--   2. UPDATE retailers SET affiliate_id = '<code>' WHERE domain = 'forbiddenplanet.com'.
--   3. Only if FP later provides an official product feed:
--      build a DirectFeedAdapter and SET is_active = TRUE at that point.
--   4. NEVER use the Shopify adapter for this domain — /products.json returns 403.

-- id is supplied explicitly: Prisma 5 drops the DB-side gen_random_uuid() default
-- and manages UUIDs in the application layer (see reconciliation migration).
-- created_at still has DEFAULT NOW(); updated_at had its default dropped by the
-- Prisma reconciliation migration (Prisma manages it in the app layer).
-- Both are supplied here so this INSERT works both in production and in the
-- Prisma shadow database, which replays all migrations from scratch.
INSERT INTO "retailers"
  ("id", "name", "domain", "platform", "country_code", "currency",
   "is_active", "trust_score", "affiliate_network", "affiliate_id",
   "sync_config", "created_at", "updated_at")
VALUES (
  gen_random_uuid(),
  'Forbidden Planet',
  'forbiddenplanet.com',
  'DIRECT_AFFILIATE',
  'GB',
  'GBP',
  FALSE,
  60,
  NULL,
  NULL,
  '{"platform_note": "Direct affiliate — FP own programme. No structured feed yet.", "affiliate_signup_url": "https://forbiddenplanet.com/affiliates/", "shopify_products_json": "403 — blocked by Cloudflare/Shopify config, do not retry", "feed_status": "pending_approval", "integration_type": "deep_link_fallback"}',
  NOW(),
  NOW()
)
ON CONFLICT ("domain") DO NOTHING;