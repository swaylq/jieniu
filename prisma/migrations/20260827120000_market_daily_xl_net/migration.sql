-- 超大单净额（新浪 r0_net）。纯新增可空列，不改既有数据。
-- 主力 = 超大单 + 大单 → 大单净额由 netAmount - netAmountXl 现算，不另存列。
ALTER TABLE "MarketDaily" ADD COLUMN "netAmountXl" DOUBLE PRECISION;
