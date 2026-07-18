import { PrismaClient } from "../../generated/prisma";
import { matchEntities, type EntityDictEntry } from "../lib/entity-tagging";

const db = new PrismaClient();

/**
 * 用当前词典**全量重建**资讯实体标注（只按 标题+摘要、去样板词）。
 * 标注全为自动生成、无人工策展，故删旧建新——这样也能清掉历史上按正文/样板词打的误标。
 */
async function main() {
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

  const items = await db.newsItem.findMany({
    select: { id: true, title: true, summary: true },
  });

  // 先在内存里算好全部标注（matchEntities 纯计算、不碰 DB），再在一个事务里原子替换，
  // 避免「删了旧标注、重建中途失败」留下部分/全部资讯无标注。
  const rows: { newsId: string; entityId: string }[] = [];
  let touched = 0;
  for (const it of items) {
    const ids = matchEntities(`${it.title}\n${it.summary}`, dict);
    if (ids.length === 0) continue;
    for (const entityId of ids) rows.push({ newsId: it.id, entityId });
    touched++;
  }

  await db.$transaction([
    db.newsEntity.deleteMany(),
    db.newsEntity.createMany({ data: rows, skipDuplicates: true }),
  ]);

  console.log(
    `retag(rebuild): 标注 ${rows.length} 条，覆盖 ${touched}/${items.length} 篇`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
