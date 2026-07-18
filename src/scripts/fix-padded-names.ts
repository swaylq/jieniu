// 修实体名的东方财富空格填充（如「五 粮 液」）——GPT 指出的绑定问题之一：填充名与巨潮 hint
// /新闻标题里的「五粮液」对不上，导致公告只绑到 STOCK、绑不到 COMPANY，公司页看着是空的。
//
// 归一化 COMPANY/STOCK 名去掉内部空白 + 把 STOCK 的资讯补绑到对应 COMPANY（修历史）。

import { PrismaClient } from "../../generated/prisma";

const db = new PrismaClient();

async function main() {
  const ents = await db.entity.findMany({
    where: { type: { in: ["COMPANY", "STOCK"] } },
    select: { id: true, name: true, shortName: true, type: true },
  });
  // 内部有空白、且非英文名（A股中文名不含空格，只有东财填充）
  const padded = ents.filter(
    (e) => /\S\s+\S/.test(e.name) && !/[a-zA-Z]{2}/.test(e.name.replace(/\(.*/, "")),
  );
  console.log(`padded 实体 ${padded.length} 个：`, padded.map((e) => `"${e.name}"`).join(", "));

  let renamed = 0;
  for (const e of padded) {
    const name = e.name.replace(/\s+/g, "");
    const shortName = e.shortName ? e.shortName.replace(/\s+/g, "") : e.shortName;
    await db.entity.update({ where: { id: e.id }, data: { name, shortName } });
    renamed++;
  }

  // 归一化后，把这些公司对应 STOCK 上已绑定的资讯补绑到 COMPANY（历史公告本只绑到了 STOCK）。
  const companies = padded.filter((e) => e.type === "COMPANY");
  let rebinds = 0;
  for (const c of companies) {
    const issue = await db.entityRelation.findFirst({
      where: { fromId: c.id, type: "ISSUES", to: { type: "STOCK" } },
      select: { toId: true },
    });
    if (!issue) continue;
    const stockNews = await db.newsEntity.findMany({
      where: { entityId: issue.toId },
      select: { newsId: true },
    });
    if (stockNews.length === 0) continue;
    const r = await db.newsEntity.createMany({
      data: stockNews.map((n) => ({ newsId: n.newsId, entityId: c.id })),
      skipDuplicates: true,
    });
    rebinds += r.count;
  }

  console.log(`已归一化 ${renamed} 个实体名；补绑 ${rebinds} 条资讯到对应公司。`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
