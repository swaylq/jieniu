import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const entityInput = z.object({ entityId: z.string() });

export const watchlistRouter = createTRPCRouter({
  follow: protectedProcedure
    .input(entityInput)
    .mutation(async ({ ctx, input }) => {
      await ctx.db.watchlist.upsert({
        where: {
          userId_entityId: {
            userId: ctx.session.user.id,
            entityId: input.entityId,
          },
        },
        create: { userId: ctx.session.user.id, entityId: input.entityId },
        update: {},
      });
      return { following: true };
    }),

  unfollow: protectedProcedure
    .input(entityInput)
    .mutation(async ({ ctx, input }) => {
      await ctx.db.watchlist.deleteMany({
        where: { userId: ctx.session.user.id, entityId: input.entityId },
      });
      return { following: false };
    }),

  isFollowing: protectedProcedure
    .input(entityInput)
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.watchlist.findUnique({
        where: {
          userId_entityId: {
            userId: ctx.session.user.id,
            entityId: input.entityId,
          },
        },
      });
      return row !== null;
    }),

  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.watchlist.findMany({
      where: { userId: ctx.session.user.id },
      orderBy: { createdAt: "desc" },
      select: {
        entity: {
          select: {
            id: true,
            name: true,
            type: true,
            ticker: true,
            // 公司那份自己没有代码，借它发行的股票的（见 lib/watch-label）。
            relFrom: {
              where: { type: "ISSUES" as const },
              select: { to: { select: { ticker: true } } },
              take: 1,
            },
          },
        },
      },
    });
    return rows.map(({ entity }) => ({
      entity: {
        id: entity.id,
        name: entity.name,
        type: entity.type,
        ticker: entity.ticker,
        issuedTicker: entity.relFrom[0]?.to.ticker ?? null,
      },
    }));
  }),

  followMany: protectedProcedure
    .input(z.object({ entityIds: z.array(z.string()).min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const res = await ctx.db.watchlist.createMany({
        data: input.entityIds.map((entityId) => ({
          userId: ctx.session.user.id,
          entityId,
        })),
        skipDuplicates: true,
      });
      return { count: res.count };
    }),
});
