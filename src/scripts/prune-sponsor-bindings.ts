// 存量清理（产品质量循环 2026-07-15 run2）：券商作「保荐机构/核查方/持续督导方」被错绑到
// 被保荐公司公告（「航材股份:中信证券…核查意见」），导致券商 feed 被别家公司公告刷屏。
// 把这类公告上、绑到「金融中介实体(券商/事务所)」的绑定剪掉，保留被保荐公司主体。
// runner.ts 已在入库端同步修复。用法：... npx tsx src/scripts/prune-sponsor-bindings.ts [--apply]

import { PrismaClient } from "../../generated/prisma";
import { isIntermediaryRole, isIntermediaryName } from "../lib/relevance";

const db = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");

  // 金融中介实体集：券商板块成员 ∪ 名字含证券/事务所/评估
  const brokerSector = await db.entity.findFirst({
    where: { type: "SECTOR", name: "券商" },
    select: { id: true },
  });
  const brokerMemberIds = brokerSector
    ? (
        await db.entityRelation.findMany({
          where: { toId: brokerSector.id, type: "BELONGS_TO" },
          select: { fromId: true },
        })
      ).map((r) => r.fromId)
    : [];
  const byName = await db.entity.findMany({
    where: { type: "COMPANY" },
    select: { id: true, name: true },
  });
  const intermediaryIds = new Set<string>([
    ...brokerMemberIds,
    ...byName.filter((d) => isIntermediaryName(d.name)).map((d) => d.id),
  ]);
  console.log(`金融中介实体: ${intermediaryIds.size} 个`);

  // 中介绑定 + 其资讯标题为保荐/核查角色 → 该绑定应剪（NewsEntity 复合主键，按 newsId+entityId 删）
  const links = await db.newsEntity.findMany({
    where: { entityId: { in: [...intermediaryIds] } },
    select: { newsId: true, news: { select: { title: true } } },
  });
  const bad = links.filter((l) => isIntermediaryRole(l.news.title));
  const roleNewsIds = [...new Set(bad.map((l) => l.newsId))];
  console.log(
    `中介实体上的绑定 ${links.length} 条 → 其中保荐/核查角色资讯(应剪其券商绑定) ${bad.length} 条 / ${roleNewsIds.length} 篇`,
  );

  // 抽样看判定
  console.log("抽样判定为「中介被错绑」的标题：");
  for (const s of bad.slice(0, 12)) console.log("  ·", s.news.title.slice(0, 46));

  if (roleNewsIds.length === 0) return;
  if (!apply) {
    console.log("\n(dry-run — 加 --apply 才真正剪除。被保荐公司主体绑定保留。)");
    return;
  }

  const del = await db.newsEntity.deleteMany({
    where: { newsId: { in: roleNewsIds }, entityId: { in: [...intermediaryIds] } },
  });
  console.log(`\n已剪除 ${del.count} 条券商中介错绑（被保荐公司主体保留）。`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
