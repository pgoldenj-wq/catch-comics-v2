-- CreateTable
CREATE TABLE "metadata_cache" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "isbn_13" VARCHAR(13) NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "metadata_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "metadata_cache_isbn_13_idx" ON "metadata_cache"("isbn_13");

-- CreateIndex
CREATE INDEX "metadata_cache_expires_at_idx" ON "metadata_cache"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "metadata_cache_source_isbn_13_key" ON "metadata_cache"("source", "isbn_13");
