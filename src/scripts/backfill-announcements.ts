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
import { targetsByNeed } from "../server/backfill-targets";

const db = new PrismaClient();

// 队列复用 `targetsByNeed`（原来这里有一份自己的 companiesByNeed，形状一样但**没有存活过滤**，
// 于是这条每 2 小时的 cron 一直在捞那 81 只退市死壳。两份队列并存必漂，删掉重复实现）。

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : 40;
  let skipped = 0;
  const need = await targetsByNeed(db, {
    market: "A", // 巨潮公告只认 A 股代码
    onSkip: (n) => (skipped = n),
  });
  const batch = need.slice(0, Number.isFinite(limit) ? limit : 40);
  const empties = need.filter((r) => r.bound === 0).length;
  console.log(
    `覆盖公司 ${need.length} 家（其中当前资讯为 0 的 ${empties} 家；跳过退市死壳/非 A 股 ${skipped} 只）` +
      ` → 本轮回填最缺的 ${batch.length} 家`,
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
