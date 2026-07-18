-- CreateEnum
CREATE TYPE "SourceTier" AS ENUM ('PRIMARY', 'MEDIA', 'DERIVED');

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" "SourceTier" NOT NULL,
    "kind" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsItem" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "tier" "SourceTier" NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "content" TEXT,
    "hash" TEXT NOT NULL,
    "importance" INTEGER NOT NULL DEFAULT 0,
    "eventType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsEntity" (
    "newsId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "relevance" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "NewsEntity_pkey" PRIMARY KEY ("newsId","entityId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Source_key_key" ON "Source"("key");

-- CreateIndex
CREATE UNIQUE INDEX "NewsItem_hash_key" ON "NewsItem"("hash");

-- CreateIndex
CREATE INDEX "NewsItem_publishedAt_idx" ON "NewsItem"("publishedAt");

-- CreateIndex
CREATE INDEX "NewsEntity_entityId_idx" ON "NewsEntity"("entityId");

-- AddForeignKey
ALTER TABLE "NewsItem" ADD CONSTRAINT "NewsItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsEntity" ADD CONSTRAINT "NewsEntity_newsId_fkey" FOREIGN KEY ("newsId") REFERENCES "NewsItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsEntity" ADD CONSTRAINT "NewsEntity_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
