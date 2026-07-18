-- AlterTable
ALTER TABLE "public"."NewsItem" ADD COLUMN     "eventId" TEXT;

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "alertPrefs" JSONB,
ADD COLUMN     "password" TEXT,
ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'STANDARD';

-- AlterTable
ALTER TABLE "public"."Watchlist" ADD COLUMN     "costBasis" DOUBLE PRECISION,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "shares" DOUBLE PRECISION,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'WATCH',
ADD COLUMN     "targetWeight" DOUBLE PRECISION,
ADD COLUMN     "weight" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "public"."Decision" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "price" DOUBLE PRECISION,
    "thesisSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InvestorProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "style" TEXT,
    "riskLevel" TEXT,
    "holdPeriod" TEXT,
    "traits" JSONB,
    "summary" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvestorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."NewsEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "entityId" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Thesis" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "bullCase" TEXT NOT NULL,
    "bearCase" TEXT NOT NULL,
    "dimensions" JSONB NOT NULL,
    "keyLevels" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "catalysts" JSONB,
    "invalidations" JSONB,

    CONSTRAINT "Thesis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ThesisDimensionState" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "dimensionKey" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'neutral',
    "lastCrossFrom" TEXT,
    "lastCrossTo" TEXT,
    "lastCrossNote" TEXT,
    "lastCrossNewsId" TEXT,
    "lastCrossNewsTitle" TEXT,
    "lastCrossAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThesisDimensionState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ThesisSignal" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "newsId" TEXT NOT NULL,
    "dimensionKey" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "materiality" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "newsTitle" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ThesisSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Decision_userId_entityId_idx" ON "public"."Decision"("userId" ASC, "entityId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "InvestorProfile_userId_key" ON "public"."InvestorProfile"("userId" ASC);

-- CreateIndex
CREATE INDEX "NewsEvent_entityId_idx" ON "public"."NewsEvent"("entityId" ASC);

-- CreateIndex
CREATE INDEX "NewsEvent_lastSeenAt_idx" ON "public"."NewsEvent"("lastSeenAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Thesis_entityId_key" ON "public"."Thesis"("entityId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ThesisDimensionState_entityId_dimensionKey_key" ON "public"."ThesisDimensionState"("entityId" ASC, "dimensionKey" ASC);

-- CreateIndex
CREATE INDEX "ThesisDimensionState_entityId_idx" ON "public"."ThesisDimensionState"("entityId" ASC);

-- CreateIndex
CREATE INDEX "ThesisDimensionState_lastCrossAt_idx" ON "public"."ThesisDimensionState"("lastCrossAt" ASC);

-- CreateIndex
CREATE INDEX "ThesisSignal_entityId_idx" ON "public"."ThesisSignal"("entityId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ThesisSignal_entityId_newsId_dimensionKey_key" ON "public"."ThesisSignal"("entityId" ASC, "newsId" ASC, "dimensionKey" ASC);

-- CreateIndex
CREATE INDEX "NewsItem_eventId_idx" ON "public"."NewsItem"("eventId" ASC);

-- AddForeignKey
ALTER TABLE "public"."Decision" ADD CONSTRAINT "Decision_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "public"."Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Decision" ADD CONSTRAINT "Decision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InvestorProfile" ADD CONSTRAINT "InvestorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."NewsItem" ADD CONSTRAINT "NewsItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "public"."NewsEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Thesis" ADD CONSTRAINT "Thesis_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "public"."Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

