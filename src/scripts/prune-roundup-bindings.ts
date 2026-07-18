// 存量清理（产品质量循环 2026-07-15）：把已入库的「综述/榜单/大盘/ETF 营销」类资讯
// 与个股(COMPANY/STOCK/PERSON)的错误绑定剪掉，只保留板块(SECTOR)归属，修「你的自选股」
// 早报与个股页里混进大盘收评/基金二季报/ETF 推广的问题。runner.ts 已在入库端同步修复。
//
// 用法：... npx tsx src/scripts/prune-roundup-bindings.ts [--apply]
//   不带 --apply 只统计（dry-run），带 --apply 才真正删除绑定。

import { PrismaClient } from "../../generated/prisma";
import { isRoundupNews, isEtfMarketing } from "../lib/relevance";

const db = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");

  // 每条资讯的绑定实体数
  const groups = await db.newsEntity.groupBy({
    by: ["newsId"],
    _count: { entityId: true },
  });
  const countBy = new Map(groups.map((g) => [g.newsId, g._count.entityId]));

  // 取所有已绑定资讯的标题
  const items = await db.newsItem.findMany({
    where: { id: { in: [...countBy.keys()] } },
    select: { id: true, title: true },
  });

  const roundupIds: string[] = [];
  for (const it of items) {
    const c = countBy.get(it.id) ?? 0;
    if (isEtfMarketing(it.title) || isRoundupNews(it.title, c)) roundupIds.push(it.id);
  }
  console.log(`扫描 ${items.length} 条已绑定资讯 → 判定综述/榜单/ETF ${roundupIds.length} 条`);

  if (roundupIds.length === 0) return;

  // 这些资讯上、绑到个股(非板块)的绑定数
  const badBindings = await db.newsEntity.count({
    where: {
      newsId: { in: roundupIds },
      entity: { type: { in: ["COMPANY", "STOCK", "PERSON"] } },
    },
  });
  console.log(`其上绑到个股(COMPANY/STOCK/PERSON)的错误绑定：${badBindings} 条`);

  // 抽样看看判定对不对
  const sample = items.filter((i) => roundupIds.includes(i.id)).slice(0, 12);
  console.log("抽样判定为综述的标题：");
  for (const s of sample) console.log("  ·", s.title);

  if (!apply) {
    console.log("\n(dry-run — 加 --apply 才真正剪除。板块 SECTOR 绑定保留。)");
    return;
  }

  const del = await db.newsEntity.deleteMany({
    where: {
      newsId: { in: roundupIds },
      entity: { type: { in: ["COMPANY", "STOCK", "PERSON"] } },
    },
  });
  console.log(`\n已剪除 ${del.count} 条个股绑定（板块归属保留）。`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
