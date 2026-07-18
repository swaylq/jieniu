import { PrismaClient } from "../../generated/prisma";
import { clusterNews } from "~/lib/event-cluster";

/**
 * Event 合并（P4-7）：把近期同事件的多篇报道聚成 NewsEvent（省 token：一簇一次 signal）。
 * 用法：
 *   env DATABASE_URL="postgresql://mac@localhost:5432/jieniu" SKIP_ENV_VALIDATION=1 \
 *     npx tsx src/scripts/cluster-events.ts [--days=7]
 * 纯 rule 预聚类（标题相似 + 实体重叠 + 24h 窗），无 AI 调用。可重复运行（重算窗口内）。
 */
const db = new PrismaClient();

async function main() {
  const daysArg = process.argv.find((a) => a.startsWith("--days="));
  const days = daysArg ? Number(daysArg.slice(7)) : Number(process.env.CLUSTER_DAYS ?? 7);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const news = await db.newsItem.findMany({
    where: { publishedAt: { gte: since } },
    orderBy: { publishedAt: "asc" },
    select: {
      id: true,
      title: true,
      publishedAt: true,
      entities: { select: { entityId: true } },
    },
  });
  console.log(`clustering ${news.length} news since ${since.toISOString().slice(0, 10)}`);

  const clusters = clusterNews(
    news.map((n) => ({
      id: n.id,
      title: n.title,
      entityIds: n.entities.map((e) => e.entityId),
      publishedAt: n.publishedAt,
    })),
  );
  const multi = clusters.filter((c) => c.count >= 2);
  console.log(`${clusters.length} clusters, ${multi.length} multi-article`);

  // 重算窗口：清掉窗口内旧 event 关联再重建（幂等）。整段放进一个事务，
  // 避免「清了旧关联、重建中途失败」把聚类抹掉一半。查询数随 multi 增长，故放宽超时。
  let created = 0;
  await db.$transaction(
    async (tx) => {
      await tx.newsItem.updateMany({
        where: { id: { in: news.map((n) => n.id) } },
        data: { eventId: null },
      });
      await tx.newsEvent.deleteMany({ where: { lastSeenAt: { gte: since } } });

      for (const c of multi) {
        const ev = await tx.newsEvent.create({
          data: {
            title: c.title,
            entityId: c.entityIds[0] ?? null,
            count: c.count,
            firstSeenAt: c.firstSeenAt,
            lastSeenAt: c.lastSeenAt,
          },
        });
        await tx.newsItem.updateMany({
          where: { id: { in: c.memberIds } },
          data: { eventId: ev.id },
        });
        created++;
      }
    },
    { maxWait: 10_000, timeout: 120_000 },
  );
  console.log(`created ${created} multi-article events. samples:`);
  for (const c of multi.slice(0, 8)) console.log(`  [${c.count}篇] ${c.title}`);
  await db.$disconnect();
}

void main();
