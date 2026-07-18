// 存量清理（产品质量循环 2026-07-15 run5·数据质量）：把纯治理/文件模板公告（公司章程/鉴证报告/
// 管理制度/H股月报表…）与个股的绑定剪掉，清个股「公告」页噪声。runner.ts 已在入库端跳过这类。
// 非破坏性：只删绑定、保留 NewsItem。用法：... npx tsx src/scripts/prune-boilerplate.ts [--apply]

import { PrismaClient } from "../../generated/prisma";
import { isBoilerplateFiling } from "../lib/relevance";

const db = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");

  // 所有有绑定的资讯（只有绑定的才会在个股页出现）
  const bound = await db.newsItem.findMany({
    where: { entities: { some: {} } },
    select: { id: true, title: true },
  });
  const boilerIds = bound.filter((n) => isBoilerplateFiling(n.title)).map((n) => n.id);
  console.log(
    `有绑定资讯 ${bound.length} 条 → 判定样板公告 ${boilerIds.length} 条（其绑定将从公告页移除）`,
  );

  const sample = bound.filter((n) => isBoilerplateFiling(n.title)).slice(0, 14);
  console.log("抽样：");
  for (const s of sample) console.log("  ·", s.title.slice(0, 44));

  if (boilerIds.length === 0) return;
  if (!apply) {
    console.log("\n(dry-run — 加 --apply 才真正剪除绑定。NewsItem 保留。)");
    return;
  }

  const del = await db.newsEntity.deleteMany({ where: { newsId: { in: boilerIds } } });
  console.log(`\n已剪除 ${del.count} 条样板公告绑定（个股「公告」页去噪；NewsItem 保留）。`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
