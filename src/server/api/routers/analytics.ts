import { z } from "zod";

import {
  createTRPCRouter,
  publicProcedure,
  protectedProcedure,
} from "~/server/api/trpc";
import { rateLimit, clientIp } from "~/lib/rate-limit";

// 埋点 type 白名单：匿名可写，故收成固定枚举，杜绝任意串刷库/污染分析。
// interpret_* 对应 5 个大师视角（见 interpretation-panel）。新增埋点类型时在此登记。
const ANALYTICS_EVENT_TYPES = [
  "view_news",
  "view_entity",
  "view_home",
  "view_notifications",
  "follow",
  "onboarding_follow",
  "interpret_NEUTRAL",
  "interpret_BUFFETT",
  "interpret_MUNGER",
  "interpret_LYNCH",
  "interpret_GRAHAM",
] as const;

export const analyticsRouter = createTRPCRouter({
  /** 轻量埋点：记录关键用户动作（登录可选，可匿名）。 */
  track: publicProcedure
    .input(
      z.object({
        type: z.enum(ANALYTICS_EVENT_TYPES),
        entityId: z.string().max(64).optional(),
        newsId: z.string().max(64).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 浏览类埋点只记登录态（2026-08-02 复盘）。`view_news` 是**服务端渲染时**打的，
      // 于是每个爬虫抓一次新闻页就写一行：近 30 天 246061 条里有 userId 的只有 577 条（0.2%），
      // 7-30 起每天 8–10 万条。限流按 IP 拦不住分布式爬取，而这些行对「用户在看什么」
      // 零信息量，却把表撑爆、把「最近浏览」之类的派生功能污染掉。匿名的浏览事件直接丢。
      if (!ctx.session?.user && input.type.startsWith("view_")) {
        return { ok: false as const };
      }
      // 匿名可写 → 按 用户/IP 限流，防脚本无限灌埋点撑库。超限静默丢弃，不打断用户操作。
      const bucket = ctx.session?.user?.id ?? `ip:${clientIp(ctx.headers)}`;
      if (!rateLimit(`track:${bucket}`, 120, 60_000)) {
        return { ok: false as const };
      }
      await ctx.db.analyticsEvent.create({
        data: {
          type: input.type,
          entityId: input.entityId ?? null,
          newsId: input.newsId ?? null,
          userId: ctx.session?.user?.id ?? null,
        },
      });
      return { ok: true as const };
    }),

  /** 最近浏览：按 view_news 埋点去重回显最近看过的资讯。 */
  recentViews: protectedProcedure.query(async ({ ctx }) => {
    const events = await ctx.db.analyticsEvent.findMany({
      where: {
        userId: ctx.session.user.id,
        type: "view_news",
        newsId: { not: null },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { newsId: true },
    });
    const ids: string[] = [];
    for (const e of events) {
      if (e.newsId && !ids.includes(e.newsId)) ids.push(e.newsId);
    }
    const top = ids.slice(0, 12);
    if (top.length === 0) return [];
    const news = await ctx.db.newsItem.findMany({
      where: { id: { in: top } },
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
    const byId = new Map(news.map((n) => [n.id, n]));
    return top
      .map((id) => byId.get(id))
      .filter((n): n is NonNullable<typeof n> => n != null);
  }),
});
