import { PrismaClient } from "../../generated/prisma";
import { cleanText, cleanInline, screenQuality } from "../lib/quality";

const db = new PrismaClient();

/**
 * 一次性质量清洗：对存量资讯做清洗(去 HTML/实体/多余空白)，
 * 并删除筛查判定为垃圾(空/超短/乱码/广告)的历史条目。幂等。
 */
async function main() {
  const items = await db.newsItem.findMany({
    select: { id: true, title: true, summary: true, content: true },
  });

  let cleaned = 0;
  let removed = 0;
  for (const it of items) {
    const title = cleanInline(it.title);
    const summary = cleanInline(it.summary);
    const content = it.content ? cleanText(it.content) : null;

    if (!screenQuality({ title, summary, content }).ok) {
      await db.newsItem.delete({ where: { id: it.id } });
      removed++;
      continue;
    }

    if (title !== it.title || summary !== it.summary || content !== it.content) {
      await db.newsItem.update({
        where: { id: it.id },
        data: { title, summary, content },
      });
      cleaned++;
    }
  }
  console.log(
    `backfill-clean: 清洗 ${cleaned} 条，删除垃圾 ${removed} 条，共 ${items.length}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
