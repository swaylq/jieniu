// 存量清理（2026-07-23 质量把关）：公司名被更长的机构名裹住而产生的误绑。
//
// 典型：「甘肃能源:关于收到**中国银行**间市场交易商协会《接受注册通知书》的公告」被绑到中国银行。
// 实测中国银行 120 条绑定里有 17 条是这样来的。入库端已把这些机构名加进 stripBoilerplate；
// 本脚本用**同一套匹配逻辑**复算历史：若去掉样板词后正文已不再提到该公司、且该公司也不是
// 源给出的权威主体（标题不以「公司名:」开头），就剪掉这条绑定。
//
// 只处理 COMPANY / STOCK 绑定，且只在「复算后确实匹配不上」时才剪，宁可少剪。
// 用法：... npx tsx src/scripts/prune-mismatched-bindings.ts [--apply]

import { PrismaClient } from "../../generated/prisma";
import { matchEntities, type EntityDictEntry } from "../lib/entity-tagging";

const db = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");

  const dict = (await db.entity.findMany({
    select: {
      id: true,
      type: true,
      name: true,
      shortName: true,
      aliases: true,
      ticker: true,
    },
  })) as EntityDictEntry[];
  const byId = new Map(dict.map((d) => [d.id, d]));

  // 只查「标题或摘要里出现过这些陷阱短语」的资讯，不必全表复算。
  const TRAPS = ["银行间市场"];
  const rows = await db.newsItem.findMany({
    where: {
      OR: TRAPS.flatMap((t) => [
        { title: { contains: t } },
        { summary: { contains: t } },
      ]),
    },
    select: {
      id: true,
      title: true,
      summary: true,
      entities: { select: { entityId: true } },
    },
  });

  const doomed: { newsId: string; entityId: string; label: string }[] = [];
  for (const r of rows) {
    const stillMatch = new Set(matchEntities(`${r.title}\n${r.summary}`, dict));
    for (const e of r.entities) {
      const ent = byId.get(e.entityId);
      if (!ent) continue;
      if (ent.type !== "COMPANY" && ent.type !== "STOCK") continue;
      if (stillMatch.has(e.entityId)) continue;
      // 权威主体保护：标题以「公司名:」开头说明源明确指定了主体，不动。
      const bare = ent.name.replace(/[（(][^）)]*[）)]\s*$/, "");
      if (r.title.startsWith(`${bare}:`) || r.title.startsWith(`${bare}：`))
        continue;
      doomed.push({
        newsId: r.id,
        entityId: e.entityId,
        label: `${ent.name} ← ${r.title.slice(0, 46)}`,
      });
    }
  }

  console.log(
    `扫描含陷阱短语的资讯 ${rows.length} 条 → 复算后应剪掉的误绑 ${doomed.length} 条`,
  );
  doomed.slice(0, 15).forEach((d) => console.log(`  - ${d.label}`));

  if (doomed.length === 0) return;
  if (!apply) {
    console.log("\n（未加 --apply，仅报告，未改动数据）");
    return;
  }
  for (const d of doomed) {
    await db.newsEntity.delete({
      where: { newsId_entityId: { newsId: d.newsId, entityId: d.entityId } },
    });
  }
  console.log(`\n已剪掉 ${doomed.length} 条误绑。`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
