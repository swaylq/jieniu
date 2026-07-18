import { z } from "zod";

import {
  createTRPCRouter,
  publicProcedure,
  protectedProcedure,
} from "~/server/api/trpc";
import { IMPORTANT_THRESHOLD } from "~/lib/importance";
import { digestSince, DIGEST_TAKE_DEEP } from "~/lib/digest";
import {
  rankDigest,
  collapseDigestItems,
  MACRO_KEYWORDS,
} from "~/lib/digest-filter";

export const newsRouter = createTRPCRouter({
  /** 单条资讯详情（含正文与关联实体），供 /news/[id] 详情页。 */
  byId: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.newsItem.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          title: true,
          url: true,
          summary: true,
          content: true,
          tier: true,
          importance: true,
          publishedAt: true,
          eventType: true,
          source: { select: { name: true } },
          entities: {
            select: {
              entity: { select: { id: true, name: true, type: true } },
            },
          },
        },
      }),
    ),

  /** 重大动态：全站高重要性资讯，按重要性×时间倒序，供首页 surfacing。 */
  important: publicProcedure.query(({ ctx }) =>
    ctx.db.newsItem.findMany({
      where: { importance: { gte: IMPORTANT_THRESHOLD } },
      orderBy: [{ importance: "desc" }, { publishedAt: "desc" }],
      take: 10,
      select: {
        id: true,
        title: true,
        url: true,
        summary: true,
        tier: true,
        publishedAt: true,
        source: { select: { name: true } },
      },
    }),
  ),

  /** 解牛早报：近 24 小时「重磅 + 宏观」Top N。剔除退市/风险警示/破产等晦气低关注项，抬升经济/政策/会议等市场级大新闻（张楚寒反馈）。只聚合已发生的一手/重磅，不预测。 */
  digest: publicProcedure.query(async ({ ctx }) => {
    const since = digestSince(new Date());
    const select = {
      id: true,
      title: true,
      importance: true,
      eventType: true,
      publishedAt: true,
      source: { select: { name: true } },
      entities: { select: { entity: { select: { id: true, type: true } } } },
    } as const;
    const [events, macro] = await Promise.all([
      // 重磅个股/公司事件
      ctx.db.newsItem.findMany({
        where: {
          importance: { gte: IMPORTANT_THRESHOLD },
          publishedAt: { gte: since },
        },
        orderBy: [{ importance: "desc" }, { publishedAt: "desc" }],
        take: 24,
        select,
      }),
      // 市场级宏观（经济/政策/会议——重要度往往不高，单独捞回来再抬升）
      ctx.db.newsItem.findMany({
        where: {
          publishedAt: { gte: since },
          OR: MACRO_KEYWORDS.map((k) => ({ title: { contains: k } })),
        },
        orderBy: [{ publishedAt: "desc" }],
        take: 24,
        select,
      }),
    ]);
    const cands = [...events, ...macro].map(({ entities, ...n }) => ({
      ...n,
      hasEntity: entities.length > 0,
      entityKeys: entities
        .filter((e) => e.entity.type === "COMPANY" || e.entity.type === "STOCK")
        .map((e) => e.entity.id),
    }));
    return rankDigest(cands, DIGEST_TAKE_DEEP);
  }),

  /** 自选股早报（张楚寒反馈 ZF-2）：你关注公司的近期材料动态（一手 / 重磅），供早报「你的自选股」段。未关注则空。 */
  personalDigest: protectedProcedure.query(async ({ ctx }) => {
    const watched = await ctx.db.watchlist.findMany({
      where: { userId: ctx.session.user.id },
      select: { entityId: true },
    });
    const ids = watched.map((w) => w.entityId);
    if (ids.length === 0) return [];
    // 单只股票 24h 未必有料，窗口放宽到 48h。
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const rows = await ctx.db.newsItem.findMany({
      where: {
        entities: { some: { entityId: { in: ids } } },
        OR: [{ tier: "PRIMARY" }, { importance: { gte: IMPORTANT_THRESHOLD } }],
        publishedAt: { gte: since },
      },
      orderBy: [{ importance: "desc" }, { publishedAt: "desc" }],
      // 多取些做同主体折叠的料——一只自选股一次定增/重组会甩几十份程序性文档，否则霸屏「你的自选股」段。
      take: DIGEST_TAKE_DEEP * 3,
      select: {
        id: true,
        title: true,
        importance: true,
        eventType: true,
        publishedAt: true,
        source: { select: { name: true } },
        entities: { select: { entity: { select: { id: true, type: true } } } },
      },
    });
    // 同主体/近重复折叠：每只自选股最多 2 条、近重复快讯碎片只留一条（自选段比公开早报略放宽，每股 2 条）。
    const collapsed = collapseDigestItems(
      rows.map(({ entities, ...r }) => ({
        ...r,
        entityKeys: entities
          .filter(
            (e) => e.entity.type === "COMPANY" || e.entity.type === "STOCK",
          )
          .map((e) => e.entity.id),
      })),
      DIGEST_TAKE_DEEP,
      2,
    );
    // 自选股段不做宏观标注（都是个股）。
    return collapsed.map(({ entityKeys: _k, ...r }) => ({ ...r, macro: false }));
  }),

  /** 最新资讯：按时间倒序的游标分页流，供首页「最新」时间线。filter：全部 / 一手(PRIMARY) / 重磅(importance≥阈值)。 */
  latest: publicProcedure
    .input(
      z.object({
        cursor: z.string().nullish(),
        limit: z.number().min(1).max(50).default(20),
        filter: z.enum(["all", "primary", "important"]).default("all"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where =
        input.filter === "primary"
          ? { tier: "PRIMARY" as const }
          : input.filter === "important"
            ? { importance: { gte: IMPORTANT_THRESHOLD } }
            : undefined;
      const items = await ctx.db.newsItem.findMany({
        where,
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
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
      let nextCursor: string | undefined = undefined;
      if (items.length > input.limit) {
        nextCursor = items.pop()?.id;
      }
      return { items, nextCursor };
    }),

  /** 相关资讯：与本条共享至少一个实体的其它资讯，按重要性×时间倒序。无关联实体则空。 */
  related: publicProcedure
    .input(
      z.object({
        id: z.string(),
        limit: z.number().min(1).max(20).default(6),
      }),
    )
    .query(async ({ ctx, input }) => {
      const self = await ctx.db.newsItem.findUnique({
        where: { id: input.id },
        select: { entities: { select: { entityId: true } } },
      });
      const entityIds = self?.entities.map((e) => e.entityId) ?? [];
      if (entityIds.length === 0) return [];

      return ctx.db.newsItem.findMany({
        where: {
          id: { not: input.id },
          entities: { some: { entityId: { in: entityIds } } },
        },
        orderBy: [{ importance: "desc" }, { publishedAt: "desc" }],
        take: input.limit,
        select: {
          id: true,
          title: true,
          url: true,
          summary: true,
          tier: true,
          publishedAt: true,
          source: { select: { name: true } },
        },
      });
    }),
});
