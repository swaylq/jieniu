// 过去一年券商研报回填（sway 2026-07-23「条数多」）。
//
// 研报在解牛里是**事件**不是推荐：记录「哪家机构在哪天发了一篇什么主题的研报」，
// 评级(买入/增持)与目标价字段一律不入库、标题含评级语言的整条丢弃（铁律②，见 lib/compliance）。
//
// 实测量级：贵州茅台一年 72 篇、宁德时代 38、汇川 21、罗博特科 2 —— 平均约 15 篇/只，
// 多数一页取完，801 只约 900 个请求，零 AI 调用。
//
// 用法：... npx tsx src/scripts/backfill-reports.ts [--months=12] [--limit=801] [--offset=0] [--batch=10]

import { PrismaClient } from "../../generated/prisma";
import { ingestSource } from "../server/ingest/runner";
import { eastmoneyReportsForCodes } from "../server/ingest/sources/eastmoney-report";
import { targetsByNeed, numArg } from "../server/backfill-targets";

const db = new PrismaClient();

async function main() {
  const months = numArg("months", 12);
  const limit = numArg("limit", 801);
  const offset = numArg("offset", 0);
  const batchSize = Math.max(1, numArg("batch", 10));

  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - months);

  const all = await targetsByNeed(db);
  const batchTargets = all.slice(offset, offset + limit);
  console.log(
    `覆盖股 ${all.length} 只 → 本轮研报回填 [${offset}, ${offset + batchTargets.length}) 共 ${batchTargets.length} 只` +
      `，区间 ${from.toISOString().slice(0, 10)} ~ ${to.toISOString().slice(0, 10)}`,
  );
  if (batchTargets.length === 0) return;

  let fetched = 0;
  let inserted = 0;
  const started = Date.now();

  for (let i = 0; i < batchTargets.length; i += batchSize) {
    const group = batchTargets.slice(i, i + batchSize);
    const codes = group.map((g) => g.code);
    const entityIds = group.flatMap((g) => g.entityIds);
    try {
      const r = await ingestSource(
        db,
        eastmoneyReportsForCodes(codes, from, to),
        { backfill: { entityIds, publishedFrom: from, publishedTo: to } },
      );
      fetched += r.fetched;
      inserted += r.inserted;
      const done = i + group.length;
      const rate = (Date.now() - started) / done;
      const eta = Math.round(((batchTargets.length - done) * rate) / 1000);
      console.log(
        `  [${done}/${batchTargets.length}] fetched=${r.fetched} inserted=${r.inserted}` +
          ` | 累计入库 ${inserted} | 剩余约 ${eta}s`,
      );
    } catch (e) {
      console.error(
        `  批次 ${codes.join(",")} 失败：${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  console.log(
    `\n本轮完成：抓取 ${fetched} 篇 → 入库 ${inserted} 篇（合规过滤/重复 ${fetched - inserted} 篇）`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
