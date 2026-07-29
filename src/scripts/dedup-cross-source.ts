// 存量去重（产品质量循环 2026-07-15 run7）：同一公告东财记「公司名:标题」、巨潮记「标题」，
// 只按整标题判重漏掉 → 个股「公告」页/自选早报同一公告出现两条。按 (绑定实体集 + 去前缀标题) 分组，
// 每组保留发布最早一条，删掉**跨源且发布同期(±2天)**的冗余副本（同源重复/相隔久的合法重复公告不动）。
// ⚠ 用 publishedAt 判近邻而非 createdAt：东财实时抓、巨潮靠回填轮转，入库时间差好几天但发布日一致。
// runner.ts 已在入库端同步修复。用法：... npx tsx src/scripts/dedup-cross-source.ts [--apply]

import { PrismaClient } from "../../generated/prisma";
import { crossSourceKey } from "../lib/dedupe";

const db = new PrismaClient();
const DAY = 24 * 60 * 60 * 1000;

async function main() {
  const apply = process.argv.includes("--apply");
  const wantJson = process.argv.includes("--json");
  // --max-apply=N：一次扫描内判定「冗余数 ≤N 才删」。原来的 cron 是 dry-run 数一遍、
  // 再 --apply 重扫一遍删，两次扫描之间集合会变（TOCTOU），且多一次全表扫描。
  const maxApplyArg = process.argv.find((a) => a.startsWith("--max-apply="));
  const maxApply = maxApplyArg ? Number(maxApplyArg.split("=")[1]) : null;
  if (maxApplyArg && (maxApply === null || !Number.isFinite(maxApply) || maxApply < 0)) {
    throw new Error(`--max-apply 取值非法: ${maxApplyArg}`);
  }

  const items = await db.newsItem.findMany({
    where: { entities: { some: {} } },
    select: {
      id: true,
      title: true,
      publishedAt: true,
      source: { select: { key: true } },
      entities: { select: { entityId: true } },
    },
    // 按发布时间排序：同一公告跨源的 publishedAt 基本一致（入库时间 createdAt 因巨潮轮转回填会差很多天，不可靠）。
    orderBy: { publishedAt: "asc" },
  });

  const groups = new Map<string, typeof items>();
  for (const n of items) {
    const key = crossSourceKey(n.title, n.entities.map((e) => e.entityId));
    const g = groups.get(key);
    if (g) g.push(n);
    else groups.set(key, [n]);
  }

  const toDelete: string[] = [];
  const sample: string[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const keep = g[0]!; // 发布时间最早一条
    for (const r of g.slice(1)) {
      // 同一公告跨源的 publishedAt 基本同日（差 1-2 天是源抓取延迟）；相隔久 = 不同事件的同模板公告，不动。
      const diffDays =
        Math.abs(r.publishedAt.getTime() - keep.publishedAt.getTime()) / DAY;
      if (r.source?.key !== keep.source?.key && diffDays <= 2) {
        toDelete.push(r.id);
        if (sample.length < 12)
          sample.push(
            `保留[${keep.source?.key}] ${keep.title.slice(0, 24)} ← 删[${r.source?.key}] ${r.title.slice(0, 24)}`,
          );
      }
    }
  }

  console.log(
    `绑定资讯 ${items.length} 条 → 跨源冗余副本(发布同期、异源) ${toDelete.length} 条`,
  );
  for (const s of sample) console.log("  ·", s);

  const overLimit = maxApply !== null && toDelete.length > maxApply;
  const willApply =
    toDelete.length > 0 && (apply || maxApply !== null) && !overLimit;

  if (overLimit) {
    console.log(
      `\n⚠ 冗余 ${toDelete.length} 条 > 上限 ${maxApply}，本轮不删——异常暴增，先让人看。`,
    );
  } else if (toDelete.length === 0) {
    console.log("\n无跨源冗余。");
  } else if (!willApply) {
    console.log("\n(dry-run — 加 --apply 才删。每组保留最早一条，级联清 NewsEntity/解读/收藏。)");
  }

  let deleted = 0;
  if (willApply) {
    // 分批删，避免 in 列表过长
    for (let i = 0; i < toDelete.length; i += 500) {
      const r = await db.newsItem.deleteMany({
        where: { id: { in: toDelete.slice(i, i + 500) } },
      });
      deleted += r.count;
    }
    console.log(`\n已删 ${deleted} 条跨源冗余（个股公告页/自选早报去重）。`);
  }

  if (wantJson) {
    console.log(
      "JSON_RESULT " +
        JSON.stringify({
          scanned: items.length,
          redundant: toDelete.length,
          deleted,
          overLimit,
        }),
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
