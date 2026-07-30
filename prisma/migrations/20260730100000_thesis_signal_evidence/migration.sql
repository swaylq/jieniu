-- 证据三件套（张楚寒 2026-07-30：「最新证据」很多不是真证据，和投资命题也没对应上）
-- fact=可核查事实 / why=为什么能验证该命题(含局限) / grade=direct|supporting|inference
-- 全部 nullable：旧行读路现判（lib/evidence.ts），不需要停机回填。
ALTER TABLE "ThesisSignal" ADD COLUMN     "fact" TEXT,
ADD COLUMN     "grade" TEXT,
ADD COLUMN     "why" TEXT;
