import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { surfacingSince } from "~/lib/importance";

export const feedRouter = createTRPCRouter({
  /** 当前用户关注实体的新闻并集，按重要性 + 时间排序。 */
  myFeed: protectedProcedure.query(async ({ ctx }) => {
    const follows = await ctx.db.watchlist.findMany({
      where: { userId: ctx.session.user.id },
      select: { entityId: true },
    });
    const entityIds = follows.map((f) => f.entityId);
    if (entityIds.length === 0) return { entityIds, items: [] };

    const items = await ctx.db.newsItem.findMany({
      where: {
        entities: { some: { entityId: { in: entityIds } } },
        // 时间窗（见 surfacingSince）：重要性优先排序下，不设窗会让一年前的重磅长期占据自选流。
        publishedAt: { gte: surfacingSince(new Date()) },
      },
      orderBy: [{ importance: "desc" }, { publishedAt: "desc" }],
      take: 50,
      select: {
        id: true,
        title: true,
        url: true,
        summary: true,
        brief: true,
        tier: true,
        importance: true,
        eventType: true,
        publishedAt: true,
        source: { select: { name: true } },
      },
    });
    return { entityIds, items };
  }),
});
