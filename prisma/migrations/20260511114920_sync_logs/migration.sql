-- CreateTable
CREATE TABLE "sync_logs" (
    "id" UUID NOT NULL,
    "retailer_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "status" VARCHAR(16) NOT NULL DEFAULT 'running',
    "products_fetched" INTEGER NOT NULL DEFAULT 0,
    "listings_created" INTEGER NOT NULL DEFAULT 0,
    "listings_updated" INTEGER NOT NULL DEFAULT 0,
    "price_changes" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "error_summary" TEXT,

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sync_logs_retailer_id_started_at_idx" ON "sync_logs"("retailer_id", "started_at" DESC);

-- AddForeignKey
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_retailer_id_fkey" FOREIGN KEY ("retailer_id") REFERENCES "retailers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
