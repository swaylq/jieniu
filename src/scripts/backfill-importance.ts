import { PrismaClient } from "../../generated/prisma";
import { scoreImportance, detectEventType } from "../lib/importance";

// 一次性回填：此前仅 cninfo 会检测 eventType，媒体历史数据 importance 恒为 30、
// 永远进不了「重大动态」/通知。这里对全部历史条目按新逻辑重算 eventType + importance。
const db = new PrismaClient();

async function main() {
  const items = await db.newsItem.findMany({
    select: {
      id: true,
      title: true,
      summary: true,
      content: true,
      tier: true,
      importance: true,
      eventType: true,
    },
  });

  let updated = 0;
  for (const n of items) {
    const eventType = detectEventType(
      `${n.title}\n${n.summary}\n${n.content ?? ""}`,
    );
    const importance = scoreImportance({ tier: n.tier, eventType });
    if (importance !== n.importance || eventType !== n.eventType) {
      await db.newsItem.update({
        where: { id: n.id },
        data: { importance, eventType },
      });
      updated++;
    }
  }
  console.log(`backfill 完成：${updated}/${items.length} 条重算`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
