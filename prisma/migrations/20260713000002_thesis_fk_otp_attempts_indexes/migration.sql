-- OTP 在线爆破防护：单个验证码的错码尝试计数（达上限即作废，见 otp-verify.ts）。
-- AlterTable
ALTER TABLE "VerificationToken" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0;

-- recentViews 按 (userId, type) 过滤、按 createdAt 排序——补复合索引，避免随埋点量增长全表扫。
-- CreateIndex
CREATE INDEX "AnalyticsEvent_userId_type_createdAt_idx" ON "AnalyticsEvent"("userId", "type", "createdAt");

-- ThesisSignal 外键的支撑索引（级联删除 + 按 newsId 查询）。
-- CreateIndex
CREATE INDEX "ThesisSignal_newsId_idx" ON "ThesisSignal"("newsId");

-- 加外键前先清理孤儿信号：entity/news 已不存在的行会违反新约束（历史上 ThesisSignal 无 FK，
-- dedup-cleanup 等删过新闻/实体后可能留下悬挂信号）。派生数据，删除无损，可由 classify-signals 重算。
DELETE FROM "ThesisSignal" WHERE "entityId" NOT IN (SELECT "id" FROM "Entity");
DELETE FROM "ThesisSignal" WHERE "newsId" NOT IN (SELECT "id" FROM "NewsItem");

-- AddForeignKey
ALTER TABLE "ThesisSignal" ADD CONSTRAINT "ThesisSignal_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ThesisSignal" ADD CONSTRAINT "ThesisSignal_newsId_fkey" FOREIGN KEY ("newsId") REFERENCES "NewsItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
