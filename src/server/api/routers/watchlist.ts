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

  list: protectedProcedure.query(({ ctx }) =>
    ctx.db.watchlist.findMany({
      where: { userId: ctx.session.user.id },
      orderBy: { createdAt: "desc" },
      select: {
        entity: { select: { id: true, name: true, type: true } },
      },
    }),
  ),

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
