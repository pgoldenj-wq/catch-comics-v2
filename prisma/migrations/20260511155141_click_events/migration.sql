-- DropIndex
DROP INDEX "idx_canonical_products_title_trgm";

-- DropIndex
DROP INDEX "idx_retailer_listings_title_trgm";

-- CreateTable
CREATE TABLE "click_events" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "user_session" TEXT,
    "referrer" TEXT,
    "user_agent" TEXT,
    "clicked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "click_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "click_events_listing_id_idx" ON "click_events"("listing_id");

-- CreateIndex
CREATE INDEX "click_events_clicked_at_idx" ON "click_events"("clicked_at");

-- AddForeignKey
ALTER TABLE "click_events" ADD CONSTRAINT "click_events_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "retailer_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
