import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

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
      where: { entities: { some: { entityId: { in: entityIds } } } },
      orderBy: [{ importance: "desc" }, { publishedAt: "desc" }],
      take: 50,
      select: {
        id: true,
        title: true,
        url: true,
        summary: true,
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
