-- CreateTable
CREATE TABLE "MarketDaily" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "tradeDate" DATE NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "changePct" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION,
    "netAmount" DOUBLE PRECISION,
    "netRatio" DOUBLE PRECISION,
    "turnoverRate" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunitySignal" (
    "id" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "ticker" TEXT,
    "sector" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "signalStrength" TEXT NOT NULL,
    "internalScore" DOUBLE PRECISION NOT NULL,
    "reasons" JSONB NOT NULL,
    "risks" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "catalystNewsIds" JSONB NOT NULL,
    "narrative" JSONB,
    "tradeDate" DATE NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "OpportunitySignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketDaily_entityId_tradeDate_idx" ON "MarketDaily"("entityId", "tradeDate");

-- CreateIndex
CREATE INDEX "MarketDaily_tradeDate_idx" ON "MarketDaily"("tradeDate");

-- CreateIndex
CREATE UNIQUE INDEX "MarketDaily_ticker_tradeDate_key" ON "MarketDaily"("ticker", "tradeDate");

-- CreateIndex
CREATE INDEX "OpportunitySignal_status_tradeDate_idx" ON "OpportunitySignal"("status", "tradeDate");

-- CreateIndex
CREATE INDEX "OpportunitySignal_entityId_idx" ON "OpportunitySignal"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "OpportunitySignal_dedupeKey_tradeDate_key" ON "OpportunitySignal"("dedupeKey", "tradeDate");

-- AddForeignKey
ALTER TABLE "MarketDaily" ADD CONSTRAINT "MarketDaily_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

