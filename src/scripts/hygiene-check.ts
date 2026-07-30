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

  // 退市死壳身上的绑定：它们是误绑磁石（「美的电器」←「南疆中亚家博城奠基」那类）。
  // 判据与 targetsByNeed 一致：A 股六位代码 + 没有资金流信号 = 不在交易。
  const flows = await db.entitySignal.findMany({
    where: { kind: "flow" },
    select: { entityId: true },
  });
  const trading = new Set(flows.map((f) => f.entityId));
  const stocks = await db.entity.findMany({
    where: { type: "STOCK", ticker: { not: null } },
    select: { id: true, ticker: true },
  });
  const deadIds = stocks
    .filter((s) => /^\d{6}$/.test(s.ticker!) && !trading.has(s.id))
    .map((s) => s.id);
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
