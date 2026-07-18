// 存量清理（产品质量循环 2026-07-15 run3）：「机构：观点」研报体裁（「中信证券：看好算力」）
// 被绑到发声机构自身，污染券商 feed（实测中信建投 70%、华泰 64%、中信证券 49% 是这类）。
// 把这类资讯与「发声机构自身」的绑定剪掉（被点评板块/标的保留；机构自身业绩/公司事件保留）。
// runner.ts 已在入库端同步修复。用法：... npx tsx src/scripts/prune-research-notes.ts [--apply]

import { PrismaClient } from "../../generated/prisma";
import {
  isInstitutionOpinionAboutOthers,
  isIntermediaryName,
} from "../lib/relevance";

const db = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");

  // 金融中介实体（券商板块成员 ∪ 名字含证券/事务所），带名字
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
  const companies = await db.entity.findMany({
    where: { type: "COMPANY" },
    select: { id: true, name: true },
  });
  const idSet = new Set<string>([
    ...brokerMemberIds,
    ...companies.filter((c) => isIntermediaryName(c.name)).map((c) => c.id),
  ]);
  const intermediaries = companies.filter((c) => idSet.has(c.id));
  console.log(`金融中介实体: ${intermediaries.length} 个`);

  // 逐机构：找其绑定资讯中「本机构：对外观点」体裁的 newsId，按机构 deleteMany
  const opinionNewsByEntity = new Map<string, string[]>();
  const sampleTitles: string[] = [];
  let total = 0;
  for (const inter of intermediaries) {
    const links = await db.newsEntity.findMany({
      where: { entityId: inter.id },
      select: { newsId: true, news: { select: { title: true } } },
    });
    const hit = links.filter((l) =>
      isInstitutionOpinionAboutOthers(l.news.title, inter.name),
    );
    if (hit.length > 0) {
      opinionNewsByEntity.set(inter.id, hit.map((l) => l.newsId));
      total += hit.length;
      for (const l of hit)
        if (sampleTitles.length < 14) sampleTitles.push(l.news.title.slice(0, 40));
    }
  }
  console.log(`判定「机构对外研报观点」错绑(应剪机构自身) ${total} 条`);
  console.log("抽样：");
  for (const t of sampleTitles) console.log("  ·", t);

  if (total === 0) return;
  if (!apply) {
    console.log("\n(dry-run — 加 --apply 才真正剪除。被点评板块/标的绑定保留。)");
    return;
  }

  let deleted = 0;
  for (const [entityId, newsIds] of opinionNewsByEntity) {
    const r = await db.newsEntity.deleteMany({
      where: { entityId, newsId: { in: newsIds } },
    });
    deleted += r.count;
  }
  console.log(`\n已剪除 ${deleted} 条研报观点错绑（发声机构自身；被点评标的保留）。`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
