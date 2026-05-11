-- DropForeignKey
ALTER TABLE "price_history" DROP CONSTRAINT "price_history_retailer_listing_fk";

-- DropForeignKey
ALTER TABLE "retailer_listings" DROP CONSTRAINT "retailer_listings_canonical_product_fk";

-- DropForeignKey
ALTER TABLE "retailer_listings" DROP CONSTRAINT "retailer_listings_retailer_fk";

-- DropIndex
DROP INDEX "price_history_listing_recorded_idx";

-- DropIndex
DROP INDEX "retailer_listings_product_price_idx";

-- AlterTable
ALTER TABLE "canonical_products" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "price_history" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "recorded_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "retailer_listings" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "first_seen_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "last_seen_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "last_price_change_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "retailers" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "last_synced_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "price_history_retailer_listing_id_recorded_at_idx" ON "price_history"("retailer_listing_id", "recorded_at");

-- AddForeignKey
ALTER TABLE "retailer_listings" ADD CONSTRAINT "retailer_listings_canonical_product_id_fkey" FOREIGN KEY ("canonical_product_id") REFERENCES "canonical_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retailer_listings" ADD CONSTRAINT "retailer_listings_retailer_id_fkey" FOREIGN KEY ("retailer_id") REFERENCES "retailers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_retailer_listing_id_fkey" FOREIGN KEY ("retailer_listing_id") REFERENCES "retailer_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "retailer_listings_retailer_sku_unique" RENAME TO "retailer_listings_retailer_id_retailer_sku_key";
