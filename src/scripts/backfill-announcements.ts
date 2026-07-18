// 热门股公告回填（GPT/张楚寒 2026-07-13：很多公司「资讯 0、公告 0」，根因是全市场滚动爬虫
// 抓不到没在窗口里出现的公司；公告应按代码定向拉巨潮）。
//
// 对「重点覆盖」热门股按代码逐个拉巨潮公告，绑定到 COMPANY+STOCK 实体，修「公告 0」。
// 最缺公告的排前面（自愈），每轮限量，可挂 cron 轮转刷新。用法：
//   ... npx tsx src/scripts/backfill-announcements.ts [--limit=40]

import { PrismaClient } from "../../generated/prisma";
import { ingestSource } from "../server/ingest/runner";
import { cninfoForCodes } from "../server/ingest/sources/cninfo";
import { eastmoneyStockNewsForCodes } from "../server/ingest/sources/eastmoney-stocknews";

const db = new PrismaClient();

/** 全部覆盖公司及其代码 + 当前已绑定资讯数，最少者优先（自愈：先补最空的，修「公告 0」）。 */
async function companiesByNeed(): Promise<{ code: string; name: string; bound: number }[]> {
  const companies = await db.entity.findMany({
    where: { type: "COMPANY" },
    select: { id: true },
  });
  const companyIds = companies.map((c) => c.id);
  if (companyIds.length === 0) return [];

  // 公司 → 其股票代码（ISSUES → STOCK.ticker）
  const issues = await db.entityRelation.findMany({
    where: { fromId: { in: companyIds }, type: "ISSUES", to: { type: "STOCK" } },
    select: { fromId: true, to: { select: { name: true, ticker: true } } },
  });
  const codeByCompany = new Map<string, { code: string; name: string }>();
  for (const i of issues) {
    if (i.to.ticker) codeByCompany.set(i.fromId, { code: i.to.ticker, name: i.to.name });
  }

  // 每个公司当前已绑定资讯数
  const counts = await db.newsEntity.groupBy({
    by: ["entityId"],
    where: { entityId: { in: companyIds } },
    _count: { entityId: true },
  });
  const boundBy = new Map(counts.map((c) => [c.entityId, c._count.entityId]));

  const rows: { code: string; name: string; bound: number }[] = [];
  for (const cid of companyIds) {
    const cc = codeByCompany.get(cid);
    if (!cc) continue;
    rows.push({ code: cc.code, name: cc.name, bound: boundBy.get(cid) ?? 0 });
  }
  // 去重代码，最缺者优先（bound 升序）
  const byCode = new Map<string, { code: string; name: string; bound: number }>();
  for (const r of rows) {
    const prev = byCode.get(r.code);
    if (!prev || r.bound < prev.bound) byCode.set(r.code, r);
  }
  return [...byCode.values()].sort((a, b) => a.bound - b.bound);
}

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : 40;
  const need = await companiesByNeed();
  const batch = need.slice(0, Number.isFinite(limit) ? limit : 40);
  const empties = need.filter((r) => r.bound === 0).length;
  console.log(
    `覆盖公司 ${need.length} 家（其中当前资讯为 0 的 ${empties} 家）→ 本轮回填最缺的 ${batch.length} 家`,
  );
  console.log("  " + batch.map((b) => `${b.name}(${b.code},${b.bound})`).join(" "));

  const codes = batch.map((b) => b.code);
  // 巨潮公告（一手）+ 东财个股资讯（媒体聚合）两路一起补：既补公告、也补媒体新闻。
  const pairs = batch.map((b) => ({ code: b.code, name: b.name.replace(/\(.*\)$/, "") }));
  const ann = await ingestSource(db, cninfoForCodes(codes));
  console.log(
    `[${ann.source}] fetched=${ann.fetched} inserted=${ann.inserted} tagged=${ann.tagged}`,
  );
  const news = await ingestSource(db, eastmoneyStockNewsForCodes(pairs));
  console.log(
    `[${news.source}] fetched=${news.fetched} inserted=${news.inserted} tagged=${news.tagged}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
