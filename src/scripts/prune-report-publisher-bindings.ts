// 存量清理（2026-07-23 一年回填）：研报被绑到了**发布机构自己**。
//
// 研报标题带「（发布机构）」后缀，若该机构本身也是覆盖公司（券商），词典打标会把它当成主体绑上去，
// 券商 feed 就会被自家研报淹没（run3 修过的旧疾）。runner 入库端已按 isReportPublisherOf 剪掉，
// 本脚本清历史：6699 篇体检发现 1 篇漏网——实体名存作「第一创业(002797)」而后缀写「（第一创业）」，
// 早期只比对 name 没对上。只剪「机构自身」这一条绑定，研报对**主体公司**的绑定完整保留。
//
// 用法：... npx tsx src/scripts/prune-report-publisher-bindings.ts [--apply]（不带 --apply 只报告）

import { PrismaClient } from "../../generated/prisma";
import { isReportPublisherOf } from "../lib/relevance";

const db = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");

  const reports = await db.newsItem.findMany({
    where: { source: { key: "eastmoney-report" } },
    select: {
      id: true,
      title: true,
      entities: {
        select: {
          entityId: true,
          entity: {
            select: { name: true, shortName: true, aliases: true },
          },
        },
      },
    },
  });

  const doomed: { newsId: string; entityId: string; label: string }[] = [];
  for (const r of reports) {
    for (const e of r.entities) {
      if (isReportPublisherOf(r.title, e.entity)) {
        doomed.push({
          newsId: r.id,
          entityId: e.entityId,
          label: `${e.entity.name} ← ${r.title.slice(0, 42)}`,
        });
      }
    }
  }

  console.log(
    `研报 ${reports.length} 篇 → 绑到发布机构自身的绑定 ${doomed.length} 条`,
  );
  doomed.slice(0, 20).forEach((d) => console.log(`  - ${d.label}`));
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
  console.log(`\n已剪掉 ${doomed.length} 条错绑（研报对主体公司的绑定不受影响）。`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
