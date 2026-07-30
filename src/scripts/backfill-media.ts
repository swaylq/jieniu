// 每股媒体资讯回填（sway 2026-07-24：每一只股都要有丰富新闻）——给全部覆盖股搜名字补
// 个股资讯（pageSize=30）。走 targetsByNeed（最缺的排最前），分批、幂等（hash 去重可重跑）。
// 与 backfill-year（补公告，np-anotice 主机）并行安全：本脚本走 search-api-web 主机。
//
// 用法：npx tsx src/scripts/backfill-media.ts [--limit=3000] [--batch=20] [--ps=30]

import { PrismaClient } from "../../generated/prisma";
import { ingestSource } from "../server/ingest/runner";
import { eastmoneyStockNewsForCodes } from "../server/ingest/sources/eastmoney-stocknews";
import { targetsByNeed, numArg } from "../server/backfill-targets";

const db = new PrismaClient();

async function main() {
  const limit = numArg("limit", 3000);
  const batchSize = Math.max(1, numArg("batch", 20));
  const ps = numArg("ps", 30);

  const all = await targetsByNeed(db, {
    // 不限市场：东财个股资讯搜索对美股也有结果，只需去掉退市死壳
    onSkip: (n) => n > 0 && console.log(`[targets] 跳过 ${n} 只退市死壳（无资金流）`),
  });
  const targets = all.slice(0, limit);
  console.log(
    `覆盖股 ${all.length} 只 → 本轮媒体回填 ${targets.length} 只（每股搜 ${ps} 条个股资讯）`,
  );
  if (targets.length === 0) return;

  let inserted = 0;
  const started = Date.now();
  for (let i = 0; i < targets.length; i += batchSize) {
    const group = targets.slice(i, i + batchSize);
    const pairs = group.map((g) => ({ name: g.name, code: g.code }));
    try {
      const r = await ingestSource(db, eastmoneyStockNewsForCodes(pairs, ps));
      inserted += r.inserted;
    } catch {
      // 整批失败只跳过，不中断
    }
    const done = i + group.length;
    const rate = (Date.now() - started) / done;
    const eta = Math.round(((targets.length - done) * rate) / 1000);
    console.log(
      `  [${done}/${targets.length}] ${group.map((g) => g.name).slice(0, 6).join(" ")} … 累计入库 ${inserted} | 剩余约 ${eta}s`,
    );
  }
  console.log(`媒体回填完成：入库 ${inserted} 条`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
