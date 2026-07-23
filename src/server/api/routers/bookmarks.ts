import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const newsInput = z.object({ newsId: z.string() });

const NEWS_SELECT = {
  id: true,
  title: true,
  url: true,
  summary: true,
  brief: true,
  tier: true,
  publishedAt: true,
  source: { select: { name: true } },
} as const;

/** 收藏：用户对单条资讯的收藏（切换 / 列表 / 状态）。 */
export const bookmarksRouter = createTRPCRouter({
  toggle: protectedProcedure
    .input(newsInput)
    .mutation(async ({ ctx, input }) => {
      const key = {
        userId_newsId: { userId: ctx.session.user.id, newsId: input.newsId },
      };
      const existing = await ctx.db.bookmark.findUnique({ where: key });
      if (existing) {
        await ctx.db.bookmark.delete({ where: key });
        return { bookmarked: false };
      }
      await ctx.db.bookmark.create({
        data: { userId: ctx.session.user.id, newsId: input.newsId },
      });
      return { bookmarked: true };
    }),

  isBookmarked: protectedProcedure
    .input(newsInput)
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.bookmark.findUnique({
        where: {
          userId_newsId: { userId: ctx.session.user.id, newsId: input.newsId },
        },
      });
      return row !== null;
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.bookmark.findMany({
      where: { userId: ctx.session.user.id },
      orderBy: { createdAt: "desc" },
      select: { news: { select: NEWS_SELECT } },
    });
    return rows.map((r) => r.news);
  }),
});
