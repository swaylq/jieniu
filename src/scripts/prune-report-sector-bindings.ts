// 存量清理（2026-07-23 质量把关）：券商研报被绑到了**板块**。
//
// 一篇《世界汽车玻璃龙头，智能化助推ASP提升（东莞证券）》讲的是福耀玻璃，但标题里的「汽车」
// 被词典匹配成板块 → 研报绑到汽车板块。实测 1,123 篇如此，半导体/人工智能这些热门板块页
// 会被上百篇个股研报刷屏。研报的主体是它的标的公司，板块不是。
//
// 入库端已由 SourceDef.subjectOnly 修好；本脚本清历史：只剪研报 → SECTOR 的绑定，
// 研报对 COMPANY / STOCK 的绑定完整保留。
//
// 用法：... npx tsx src/scripts/prune-report-sector-bindings.ts [--apply]

import { PrismaClient } from "../../generated/prisma";

const db = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");

  const doomed = await db.newsEntity.findMany({
    where: {
      news: { source: { key: "eastmoney-report" } },
      entity: { type: "SECTOR" },
    },
    select: {
      newsId: true,
      entityId: true,
      entity: { select: { name: true } },
    },
  });

  const bySector = new Map<string, number>();
  for (const d of doomed)
    bySector.set(d.entity.name, (bySector.get(d.entity.name) ?? 0) + 1);

  console.log(`研报 → 板块 的错绑共 ${doomed.length} 条，涉及 ${bySector.size} 个板块：`);
  [...bySector.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([k, v]) => console.log(`  ${k}  ${v} 条`));

  if (doomed.length === 0) return;
  if (!apply) {
    console.log("\n（未加 --apply，仅报告，未改动数据）");
    return;
  }
  const res = await db.newsEntity.deleteMany({
    where: {
      news: { source: { key: "eastmoney-report" } },
      entity: { type: "SECTOR" },
    },
  });
  console.log(`\n已剪掉 ${res.count} 条（研报对标的公司/股票的绑定不受影响）。`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
