import { PrismaClient } from "../../generated/prisma";
import { detectEventType, scoreImportance } from "../lib/importance";

const db = new PrismaClient();

/**
 * 统一重算：事件类型只认标题（去掉历史上按正文误判、把 routine 公告抬进重大动态的分），
 * 并套用扩充后的事件词典；重要度随之更新。一次性维护脚本。
 */
async function main() {
  const items = await db.newsItem.findMany({
    select: { id: true, title: true, tier: true, eventType: true, importance: true },
  });
  let changed = 0;
  for (const it of items) {
    const eventType = detectEventType(it.title);
    const importance = scoreImportance({ tier: it.tier, eventType });
    if (eventType !== it.eventType || importance !== it.importance) {
      await db.newsItem.update({
        where: { id: it.id },
        data: { eventType, importance },
      });
      changed++;
    }
  }
  console.log(`rescore: 更新 ${changed}/${items.length} 篇`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
