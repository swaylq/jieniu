-- 机构痕迹（交易所真实披露的席位级买卖）。纯新增表，不动既有数据。
CREATE TABLE "InstitutionalTrace" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "tradeDate" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "netAmount" DOUBLE PRECISION NOT NULL,
    "buyAmount" DOUBLE PRECISION NOT NULL,
    "sellAmount" DOUBLE PRECISION NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstitutionalTrace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InstitutionalTrace_ticker_tradeDate_kind_key" ON "InstitutionalTrace"("ticker", "tradeDate", "kind");
CREATE INDEX "InstitutionalTrace_tradeDate_kind_idx" ON "InstitutionalTrace"("tradeDate", "kind");
CREATE INDEX "InstitutionalTrace_entityId_tradeDate_idx" ON "InstitutionalTrace"("entityId", "tradeDate");

ALTER TABLE "InstitutionalTrace" ADD CONSTRAINT "InstitutionalTrace_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
