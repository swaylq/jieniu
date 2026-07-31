-- 盘前场次（张楚寒 2026-07-31：「昨晚美股的信息没 update 上去」）。
-- 复盘一天只在收盘后生成一次，早上看到的永远是昨天那份，隔夜海外按定义赶不上。
-- session: close=收盘复盘 | preopen=盘前简报（覆盖昨收以来的隔夜行情与公告）。
-- 存量行全部是收盘复盘 → 默认值 'close' 即正确，无需回填。
DROP INDEX "MarketDigest_tradeDate_market_key";
ALTER TABLE "MarketDigest" ADD COLUMN     "session" TEXT NOT NULL DEFAULT 'close';
CREATE UNIQUE INDEX "MarketDigest_tradeDate_market_session_key" ON "MarketDigest"("tradeDate", "market", "session");
