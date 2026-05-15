-- DropIndex
DROP INDEX "idx_canonical_products_title_trgm";

-- DropIndex
DROP INDEX "idx_retailer_listings_title_trgm";

-- AlterTable
ALTER TABLE "api_usage_log" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "called_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "canonical_products" ADD COLUMN     "deleted_at" TIMESTAMP(3);
