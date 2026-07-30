// 数据卫生守望（2026-07-30 run3）。只读，不改任何数据；给调度器打 JSON_RESULT。
//
// 为什么是「守望」而不是「周期清理」：run2 量过 9 个 prune-* 脚本，6 个收益为 0
// （入库端当初都配套修好了），剩下 3 个的类别近 5 天零新增。周期跑清理是在治症状，
// 而且这些一次性脚本会随时间**漂出**它们配套的入库逻辑——run2 实测其中两个盲跑会造成损失
// （一个缺 subjectOnly 豁免会删掉 2511 条正确绑定，一个有 7.7% 误判率）。
//
// 可持续的形态是：**入库端不产生 + 复发时告警**。这个脚本只负责后半句。
// 它输出的是「现在库里还有多少条该类错绑」，调度器用基线式判据看它有没有涨。
//
// 用法：... npx tsx src/scripts/hygiene-check.ts --json

import { PrismaClient } from "../../generated/prisma";
import { isRoundupNews, isEtfMarketing } from "../lib/relevance";
import { subjectOnlySourceNames } from "../server/ingest/subject-only";
import { deadShellStockIds } from "../server/backfill-targets";

const db = new PrismaClient();

async function main() {
  const json = process.argv.includes("--json");
  const subjectOnly = subjectOnlySourceNames();

  const groups = await db.newsEntity.groupBy({
    by: ["newsId"],
    _count: { entityId: true },
  });
  const countBy = new Map(groups.map((g) => [g.newsId, g._count.entityId]));

  const items = await db.newsItem.findMany({
    where: { id: { in: [...countBy.keys()] } },
    select: { id: true, title: true, source: { select: { name: true } } },
  });

  // 综述/榜单被绑到个股——与 runner.ts 同一条规则，含 subjectOnly 豁免
  const roundupIds: string[] = [];
  for (const it of items) {
    const c = countBy.get(it.id) ?? 0;
    if (!(isEtfMarketing(it.title) || isRoundupNews(it.title, c))) continue;
    if (subjectOnly.has(it.source.name)) continue;
    roundupIds.push(it.id);
  }
  const roundupMisbound = await db.newsEntity.count({
    where: {
      newsId: { in: roundupIds },
      entity: { type: { in: ["COMPANY", "STOCK", "PERSON"] } },
    },
  });

  // 退市死壳身上的绑定：它们是误绑磁石（「中国北车」←「中国中车签516亿大单」那类）。
  // **复用** targetsByNeed 的存活判据，不在这里另写一份（run2 就是栽在两处判据漂移上）。
  // 注意只数 STOCK 自身：配对的 COMPANY 常常同时是**活股**的发行方
  // （东方明珠 COMPANY 既连着退市的 600832、也连着在交易的 600637），
  // 把它算进来会把活公司的绑定误计成死壳的——run5 的第一版测量就这么错过一次。
  const deadIds = await deadShellStockIds(db);
  const deadShellBindings = await db.newsEntity.count({
    where: { entityId: { in: deadIds } },
  });

  console.log("=== 数据卫生守望 ===");
  console.log(`  已绑定资讯 ${items.length} 条`);
  console.log(`  综述/榜单被绑到个股：${roundupMisbound} 条`);
  console.log(`  退市死壳（A股代码且无资金流，${deadIds.length} 只）身上的绑定：${deadShellBindings} 条`);

  if (json) {
    console.log(
      `JSON_RESULT ${JSON.stringify({
        boundNews: items.length,
        roundupMisbound,
        deadShells: deadIds.length,
        deadShellBindings,
      })}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
