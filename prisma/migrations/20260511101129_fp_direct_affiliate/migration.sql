-- AlterEnum
-- Adds DIRECT_AFFILIATE for retailers that run their own affiliate programme
-- with no network intermediary (not Awin, not CJ, etc.).
-- NOTE: PostgreSQL requires ADD VALUE to commit before the new label can be
-- used in an INSERT. The Forbidden Planet seed row lives in the next migration.
ALTER TYPE "RetailerPlatform" ADD VALUE 'DIRECT_AFFILIATE';
