// 清理已爬入库的退市/ST 噪声资讯（张楚寒 2026-07-13：这种新闻关注的人根本没有）。
// NewsEntity / Bookmark 等对 NewsItem 均 onDelete: Cascade，直接 deleteMany 即可级联清理。

import { PrismaClient } from "../../generated/prisma";

const db = new PrismaClient();

// 与 lib/universe.ts 的 DELISTING_TITLE 对齐：只删「股票退市」专属措辞，不含终止上市/摘牌（可转债兑付也用，别误杀）。
const DELISTING_TITLE = ["退市整理", "进入退市", "退市风险提示", "暂停上市"];

async function main() {
  const where = { OR: DELISTING_TITLE.map((t) => ({ title: { contains: t } })) };
  const before = await db.newsItem.count({ where });
  const sample = await db.newsItem.findMany({
    where,
    select: { title: true },
    take: 8,
  });
  console.log(`待清理退市噪声资讯：${before} 条，例如：`);
  for (const s of sample) console.log(`  · ${s.title}`);

  const del = await db.newsItem.deleteMany({ where });
  const after = await db.newsItem.count({ where });
  console.log(`\n已删除 ${del.count} 条 → 剩余匹配 ${after} 条`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
