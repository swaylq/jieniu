// 新纳入股的丰富回填（sway 2026-07-25：纳入所有公司 + 扩充新闻丰富度）——一遍给「新闻稀薄」的
// 股同时补 公告(东财) + 媒体资讯(个股资讯 pageSize=30)。精准按「当前绑定数 < 阈值」取目标，
// 避免 targetsByNeed 总量排序补不到源特定缺口的问题。单进程内顺序跑两源，别并发（并发易被杀）。
//
// 用法：npx tsx src/scripts/backfill-new.ts [--months=12] [--batch=12] [--ps=30] [--under=40]
// 幂等：hash 去重，被杀后原样重跑即续（阈值筛选自动跳过已填够的）。

import { PrismaClient } from "../../generated/prisma";
import { ingestSource } from "../server/ingest/runner";
import { eastmoneyAnnForCodes } from "../server/ingest/sources/eastmoney-ann";
import { eastmoneyStockNewsForCodes } from "../server/ingest/sources/eastmoney-stocknews";
import { targetsByNeed, numArg } from "../server/backfill-targets";

const db = new PrismaClient();

async function main() {
  const months = numArg("months", 12);
  const batchSize = Math.max(1, numArg("batch", 12));
  const ps = numArg("ps", 30);
  const under = numArg("under", 40); // 只回填绑定数 < under 的股（新纳入/稀薄的）

  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - months);

  // 已按绑定数升序；退市死壳已剔除（否则队头永远是那 81 只壳）
  const all = await targetsByNeed(db, {
    market: "A", // 东财 A 股接口，喂美股代码取不到东西
    onSkip: (n) => n > 0 && console.log(`[targets] 跳过 ${n} 只（退市死壳 + 非 A 股）`),
  });
  const targets = all.filter((t) => t.bound < under);
  console.log(
    `覆盖股 ${all.length} 只 → 绑定<${under} 的 ${targets.length} 只需丰富回填，区间 ${from.toISOString().slice(0, 10)}~${to.toISOString().slice(0, 10)}`,
  );
  if (targets.length === 0) return;

  let annIns = 0;
  let mediaIns = 0;
  const started = Date.now();
  for (let i = 0; i < targets.length; i += batchSize) {
    const group = targets.slice(i, i + batchSize);
    const codes = group.map((g) => g.code);
    const pairs = group.map((g) => ({ name: g.name, code: g.code }));
    const entityIds = group.flatMap((g) => g.entityIds);
    // 公告（东财，带回填判重范围）
    try {
      const r = await ingestSource(db, eastmoneyAnnForCodes(codes, from, to), {
        backfill: { entityIds, publishedFrom: from, publishedTo: to },
      });
      annIns += r.inserted;
    } catch {
      /* 整批公告失败只跳过 */
    }
    // 媒体资讯（个股资讯，搜名字）
    try {
      const r = await ingestSource(db, eastmoneyStockNewsForCodes(pairs, ps));
      mediaIns += r.inserted;
    } catch {
      /* 整批媒体失败只跳过 */
    }
    const done = i + group.length;
    const rate = (Date.now() - started) / done;
    const eta = Math.round(((targets.length - done) * rate) / 1000);
    console.log(
      `  [${done}/${targets.length}] ${group.map((g) => g.name).slice(0, 6).join(" ")} … 公告+${annIns} 媒体+${mediaIns} | 剩余约 ${eta}s`,
    );
  }
  console.log(`新股丰富回填完成：公告 ${annIns} 条 + 媒体 ${mediaIns} 条`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
