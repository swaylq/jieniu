import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { normalizeAlertPrefs } from "~/lib/alert-protocol";
import {
  normalizeUserDimensions,
  userDimensionStatus,
} from "~/lib/user-thesis";

const IMPORTANT_GTE = 55;

/** 通知中心：关注实体的高重要性新资讯。 */
export const notificationsRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const watched = await ctx.db.watchlist.findMany({
      where: { userId: ctx.session.user.id },
      select: { entityId: true },
    });
    const ids = watched.map((w) => w.entityId);
    if (ids.length === 0) return [];
    return ctx.db.newsItem.findMany({
      where: {
        importance: { gte: IMPORTANT_GTE },
        entities: { some: { entityId: { in: ids } } },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        title: true,
        url: true,
        summary: true,
        tier: true,
        publishedAt: true,
        createdAt: true,
        source: { select: { name: true } },
      },
    });
  }),

  /**
   * thesis 维度状态跨越（P4-8→S3）：只在维度「跨越」到新方向时才提醒。
   * S3 个性化：按用户自有 thesis 过滤（静音的维度不提醒、重点维度优先排），
   * 并附「是否已复核」——已复核的沉到底、新的跨越（更晚的 lastCrossAt）会重新浮现。
   */
  thesisAlerts: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const watched = await ctx.db.watchlist.findMany({
      where: { userId },
      select: { entityId: true },
    });
    const ids = watched.map((w) => w.entityId);
    if (ids.length === 0) return [];
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [crossings, userTheses, reviews] = await Promise.all([
      ctx.db.thesisDimensionState.findMany({
        where: { entityId: { in: ids }, lastCrossAt: { gte: since } },
        orderBy: { lastCrossAt: "desc" },
        take: 50,
        select: {
          id: true,
          entityId: true,
          dimensionKey: true,
          lastCrossFrom: true,
          lastCrossTo: true,
          lastCrossNote: true,
          lastCrossNewsId: true,
          lastCrossNewsTitle: true,
          lastCrossAt: true,
        },
      }),
      ctx.db.userThesis.findMany({
        where: { userId, entityId: { in: ids } },
        select: { entityId: true, dimensions: true },
      }),
      ctx.db.thesisAlertReview.findMany({
        where: { userId, entityId: { in: ids } },
        select: { entityId: true, dimensionKey: true, crossedAt: true, action: true },
      }),
    ]);
    if (crossings.length === 0) return [];
    const dimsByEntity = new Map(
      userTheses.map((u) => [
        u.entityId,
        normalizeUserDimensions(u.dimensions as unknown as unknown[]),
      ]),
    );
    const reviewByKey = new Map(
      reviews.map((r) => [`${r.entityId}::${r.dimensionKey}`, r]),
    );
    const entIds = [...new Set(crossings.map((c) => c.entityId))];
    const ents = await ctx.db.entity.findMany({
      where: { id: { in: entIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(ents.map((e) => [e.id, e.name]));

    const items = [];
    for (const c of crossings) {
      const dims = dimsByEntity.get(c.entityId);
      const st = dims ? userDimensionStatus(dims, c.dimensionKey) : null;
      if (st?.muted) continue; // 用户静音了该维度 → 不提醒
      const review = reviewByKey.get(`${c.entityId}::${c.dimensionKey}`);
      const crossedAt = c.lastCrossAt!;
      const acknowledged = !!review && review.crossedAt >= crossedAt;
      items.push({
        id: c.id,
        entityId: c.entityId,
        entityName: nameById.get(c.entityId) ?? "",
        dimensionKey: c.dimensionKey,
        fromState: c.lastCrossFrom ?? "neutral",
        toState: c.lastCrossTo ?? "neutral",
        note: c.lastCrossNote ?? "",
        newsId: c.lastCrossNewsId,
        newsTitle: c.lastCrossNewsTitle ?? "",
        crossedAt,
        createdAt: crossedAt,
        priority: st?.priority ?? false,
        acknowledged,
        reviewAction: acknowledged ? (review?.action ?? null) : null,
      });
    }
    // 未复核优先 → 重点优先 → 时间倒序
    items.sort((a, b) => {
      if (a.acknowledged !== b.acknowledged) return a.acknowledged ? 1 : -1;
      if (a.priority !== b.priority) return a.priority ? -1 : 1;
      return b.crossedAt.getTime() - a.crossedAt.getTime();
    });
    return items;
  }),

  /** 复核某维度跨越（S3 闭环）：已复核/不相关/仍有效。记录针对的跨越时刻——之后更晚的新跨越会重新浮现。 */
  reviewThesisAlert: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
        dimensionKey: z.string(),
        crossedAt: z.date(),
        action: z.enum(["reviewed", "dismissed", "still_valid"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await ctx.db.thesisAlertReview.upsert({
        where: {
          userId_entityId_dimensionKey: {
            userId,
            entityId: input.entityId,
            dimensionKey: input.dimensionKey,
          },
        },
        create: {
          userId,
          entityId: input.entityId,
          dimensionKey: input.dimensionKey,
          crossedAt: input.crossedAt,
          action: input.action,
        },
        update: { crossedAt: input.crossedAt, action: input.action },
      });
      return { ok: true };
    }),

  /**
   * 已触发的到价提醒（#3b）：cron 比价触发后 active=false + triggeredAt/triggeredPrice；提醒中心露出。
   * 受「价格提醒」分类开关（alertPrefs.price）控制；近 30 日、倒序。
   */
  triggeredPriceAlerts: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { alertPrefs: true },
    });
    if (!normalizeAlertPrefs(user?.alertPrefs).price) return [];
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    return ctx.db.priceAlert.findMany({
      where: {
        userId: ctx.session.user.id,
        active: false,
        triggeredAt: { gte: since },
      },
      orderBy: { triggeredAt: "desc" },
      take: 30,
      select: {
        id: true,
        direction: true,
        threshold: true,
        triggeredAt: true,
        triggeredPrice: true,
        entity: { select: { id: true, name: true, ticker: true } },
      },
    });
  }),

  /** 上次「已读水位线」（notificationsSeenAt）——供列表区分本次访问的新动态；须在 markSeen 之前读取。 */
  seenBoundary: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { notificationsSeenAt: true },
    });
    return user?.notificationsSeenAt ?? null;
  }),

  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const watched = await ctx.db.watchlist.findMany({
      where: { userId: ctx.session.user.id },
      select: { entityId: true },
    });
    const ids = watched.map((w) => w.entityId);
    if (ids.length === 0) return 0;
    const user = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { notificationsSeenAt: true },
    });
    const seenAt = user?.notificationsSeenAt ?? null;
    const where: {
      importance: { gte: number };
      entities: { some: { entityId: { in: string[] } } };
      createdAt?: { gt: Date };
    } = {
      importance: { gte: IMPORTANT_GTE },
      entities: { some: { entityId: { in: ids } } },
    };
    if (seenAt) where.createdAt = { gt: seenAt };
    return ctx.db.newsItem.count({ where });
  }),

  markSeen: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db.user.update({
      where: { id: ctx.session.user.id },
      data: { notificationsSeenAt: new Date() },
    });
    return { ok: true };
  }),

  /** 提醒协议（P5-8）：读取用户分类开关（归一化，不可用分类强制关）。 */
  alertPrefs: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { alertPrefs: true },
    });
    return normalizeAlertPrefs(user?.alertPrefs);
  }),

  /** 设置某个分类开关。不可用分类（价格/催化）会被归一化强制关。 */
  setAlertPref: protectedProcedure
    .input(
      z.object({
        category: z.enum(["logic", "fundamental", "catalyst", "price"]),
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUnique({
        where: { id: ctx.session.user.id },
        select: { alertPrefs: true },
      });
      const prefs = normalizeAlertPrefs(user?.alertPrefs);
      prefs[input.category] = input.enabled;
      const next = normalizeAlertPrefs(prefs); // 再归一化：不可用分类强制关
      await ctx.db.user.update({
        where: { id: ctx.session.user.id },
        data: { alertPrefs: next },
      });
      return next;
    }),
});
