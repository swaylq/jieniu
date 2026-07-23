// 存量清理（2026-07-23 质量把关）：同一份公告在巨潮与东财各存了一条。
//
// runner 的回填判重键带**发布日**（historicalKey），本意是保住「回购进展公告」这类
// 一年重复十几次、标题一字不差的周期性公告。代价是：两个源对同一份公告的日期常差 1–2 天
// （东财用 notice_date=官方公告日，巨潮用 announcementTime=实际披露时刻，晚间披露就跨天），
// 于是同一份公告判不到一起。实测 697 组。
//
// 清理规则刻意保守：
//  · **只并跨源的**（巨潮 × 东财）。同一个源里出现两条同名公告更可能是两件真事，一律不动。
//  · 日期须相差 ≤2 天。相隔很远的同名公告是周期性公告，保留。
//  · 保留优先级：有正文的 > 无正文的；同等则保留东财（有 art_code，可继续补正文）；再同等留最早的。
//
// 用法：... npx tsx src/scripts/prune-cross-source-filings.ts [--apply]

import { PrismaClient } from "../../generated/prisma";
import { normalizeTitle, stripEntityPrefix } from "../lib/dedupe";

const db = new PrismaClient();

/** 天数差 */
const dayGap = (a: Date, b: Date) =>
  Math.abs(a.getTime() - b.getTime()) / 86_400_000;

type Item = {
  id: string;
  title: string;
  publishedAt: Date;
  content: string | null;
  sourceKey: string;
};

/** 组内保留哪一条：有正文 > 东财 > 最早。 */
function pickKeeper(group: Item[]): Item {
  return [...group].sort((a, b) => {
    const ca = a.content ? 1 : 0;
    const cb = b.content ? 1 : 0;
    if (ca !== cb) return cb - ca;
    const ea = a.sourceKey === "eastmoney-announcement" ? 1 : 0;
    const eb = b.sourceKey === "eastmoney-announcement" ? 1 : 0;
    if (ea !== eb) return eb - ea;
    return a.publishedAt.getTime() - b.publishedAt.getTime();
  })[0]!;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const rows = await db.newsItem.findMany({
    where: { tier: "PRIMARY" },
    select: {
      id: true,
      title: true,
      publishedAt: true,
      content: true,
      source: { select: { key: true } },
      entities: {
        select: { entityId: true, entity: { select: { type: true } } },
      },
    },
  });

  // 按 (公司实体, 去前缀归一标题) 分组
  const groups = new Map<string, Item[]>();
  for (const r of rows) {
    const co = r.entities.find((e) => e.entity.type === "COMPANY");
    if (!co) continue;
    const key = `${co.entityId}::${normalizeTitle(stripEntityPrefix(r.title))}`;
    const item: Item = {
      id: r.id,
      title: r.title,
      publishedAt: r.publishedAt,
      content: r.content,
      sourceKey: r.source.key,
    };
    const arr = groups.get(key);
    if (arr) arr.push(item);
    else groups.set(key, [item]);
  }

  const doomed: { id: string; title: string; why: string }[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sources = new Set(group.map((g) => g.sourceKey));
    if (sources.size < 2) continue; // 同源同名 → 更可能是两件真事，不动

    // 在跨源的条目里找「日期相差 ≤2 天」的簇
    const sorted = [...group].sort(
      (a, b) => a.publishedAt.getTime() - b.publishedAt.getTime(),
    );
    let cluster: Item[] = [];
    const flush = () => {
      if (cluster.length >= 2 && new Set(cluster.map((c) => c.sourceKey)).size >= 2) {
        const keeper = pickKeeper(cluster);
        for (const c of cluster) {
          if (c.id === keeper.id) continue;
          doomed.push({
            id: c.id,
            title: c.title.slice(0, 44),
            why: `${c.sourceKey} ${c.publishedAt.toISOString().slice(0, 10)} → 保留 ${keeper.sourceKey} ${keeper.publishedAt.toISOString().slice(0, 10)}`,
          });
        }
      }
      cluster = [];
    };
    for (const it of sorted) {
      if (cluster.length === 0) cluster.push(it);
      else if (dayGap(cluster[cluster.length - 1]!.publishedAt, it.publishedAt) <= 2)
        cluster.push(it);
      else {
        flush();
        cluster.push(it);
      }
    }
    flush();
  }

  console.log(`跨源重复公告：可删 ${doomed.length} 条`);
  doomed.slice(0, 12).forEach((d) => console.log(`  - ${d.title} | ${d.why}`));

  if (doomed.length === 0) return;
  if (!apply) {
    console.log("\n（未加 --apply，仅报告，未改动数据）");
    return;
  }
  const res = await db.newsItem.deleteMany({
    where: { id: { in: doomed.map((d) => d.id) } },
  });
  console.log(`\n已删除 ${res.count} 条重复公告（绑定随 onDelete: Cascade 一并清理）。`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
