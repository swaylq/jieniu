import { createTRPCRouter, publicProcedure, protectedProcedure } from "~/server/api/trpc";
import { normalizeDrivers, type MarketDigestData } from "~/lib/market-digest";
import type { MarketBreadth } from "~/lib/digest-substance";
import type { UserDigestData } from "~/lib/user-digest";

/**
 * 每日 AI 市场复盘（首屏卡片 + 邮件复用）。
 * 只读最新一条；生成在 cron 里做（`src/scripts/generate-market-digest.ts`），页面永不触发 AI 调用——
 * 首屏渲染路径上挂一个 10s+ 的 LLM 请求会把整页拖死。
 */
export const briefRouter = createTRPCRouter({
  today: publicProcedure.query(async ({ ctx }) => {
    const d = await ctx.db.marketDigest.findFirst({
      where: { market: "CN" },
      orderBy: { tradeDate: "desc" },
    });
    if (!d) return null;
    const sectors = (d.sectors ?? { strong: [], weak: [] }) as MarketDigestData["sectors"];
    const data: MarketDigestData = {
      overview: d.overview,
      drivers: normalizeDrivers(d.drivers),
      sectors: {
        strong: sectors.strong ?? [],
        weak: sectors.weak ?? [],
      },
      stocks: (d.stocks ?? []) as MarketDigestData["stocks"],
      watchpoints: (d.watchpoints ?? []) as string[],
      judgment: d.judgment,
      breadth: (d.stats ?? null) as MarketBreadth | null,
    };
    // 不返回 model：模型名属于实现细节，不该出现在客户端载荷里（DB 仍存，供溯源）
    return { tradeDate: d.tradeDate, data };
  }),

  /** 我的个人复盘——贴着自己的持仓写的那份。同样只读，不触发 AI。 */
  mine: protectedProcedure.query(async ({ ctx }) => {
    const d = await ctx.db.userDigest.findFirst({
      where: { userId: ctx.session.user.id, market: "CN" },
      orderBy: { tradeDate: "desc" },
    });
    if (!d) return null;
    const data: UserDigestData = {
      headline: d.headline,
      portfolio: d.portfolio as unknown as UserDigestData["portfolio"],
      exposure: d.exposure as unknown as UserDigestData["exposure"],
      touched: d.touched as unknown as UserDigestData["touched"],
      watchpoints: (d.watchpoints ?? []) as string[],
      judgment: d.judgment,
    };
    // 不返回 model：模型名属于实现细节，不该出现在客户端载荷里（DB 仍存，供溯源）
    return { tradeDate: d.tradeDate, data };
  }),
});
