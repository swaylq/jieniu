import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { tickerToSymbol } from "~/lib/quote";

const MAX_ALERTS_PER_USER = 100;

const alertSelect = {
  id: true,
  direction: true,
  threshold: true,
  active: true,
  note: true,
  triggeredAt: true,
  triggeredPrice: true,
  createdAt: true,
} as const;

/**
 * 自定义价位提醒（#3b）。合规：用户**自设**「到价通知我」——非荐买/荐卖（铁律②）。
 * 触发由 cron（checkPriceAlerts）比价一次性置 active=false，提醒中心露出。
 */
export const priceAlertRouter = createTRPCRouter({
  /** 某标的下当前用户的提醒（个股页控件用）。 */
  listByEntity: protectedProcedure
    .input(z.object({ entityId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.priceAlert.findMany({
        where: { userId: ctx.session.user.id, entityId: input.entityId },
        orderBy: [{ active: "desc" }, { createdAt: "desc" }],
        select: alertSelect,
      }),
    ),

  /** 当前用户的全部提醒（管理/提醒中心用），带标的名。 */
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db.priceAlert.findMany({
      where: { userId: ctx.session.user.id },
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
      select: {
        ...alertSelect,
        entity: { select: { id: true, name: true, ticker: true } },
      },
    }),
  ),

  create: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
        direction: z.enum(["above", "below"]),
        threshold: z.number().finite().positive().max(100000),
        note: z.string().max(200).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const entity = await ctx.db.entity.findUnique({
        where: { id: input.entityId },
        select: {
          ticker: true,
          relFrom: {
            where: { type: "ISSUES" },
            select: { to: { select: { ticker: true } } },
          },
        },
      });
      if (!entity) {
        throw new TRPCError({ code: "NOT_FOUND", message: "标的不存在" });
      }
      const ticker =
        entity.ticker ??
        entity.relFrom.find((r) => r.to.ticker)?.to.ticker ??
        null;
      if (!ticker || !tickerToSymbol(ticker)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "该标的没有可监控的 A 股行情",
        });
      }
      const activeCount = await ctx.db.priceAlert.count({
        where: { userId: ctx.session.user.id, active: true },
      });
      if (activeCount >= MAX_ALERTS_PER_USER) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `生效中的到价提醒最多 ${MAX_ALERTS_PER_USER} 条，先清理一些再加。`,
        });
      }
      // 去重：同标的同方向同价位的生效提醒已存在则复用，不重复建。
      const dup = await ctx.db.priceAlert.findFirst({
        where: {
          userId: ctx.session.user.id,
          entityId: input.entityId,
          direction: input.direction,
          threshold: input.threshold,
          active: true,
        },
        select: { id: true },
      });
      if (dup) return { id: dup.id, duplicated: true };
      const note = input.note?.trim() ? input.note.trim() : null;
      const created = await ctx.db.priceAlert.create({
        data: {
          userId: ctx.session.user.id,
          entityId: input.entityId,
          ticker,
          direction: input.direction,
          threshold: input.threshold,
          note,
        },
        select: { id: true },
      });
      return { id: created.id, duplicated: false };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.priceAlert.deleteMany({
        where: { id: input.id, userId: ctx.session.user.id },
      });
      return { ok: true };
    }),

  /** 启用/停用；重新启用时清掉上次触发标记，让它能再次触发。 */
  toggle: protectedProcedure
    .input(z.object({ id: z.string(), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.priceAlert.updateMany({
        where: { id: input.id, userId: ctx.session.user.id },
        data: {
          active: input.active,
          ...(input.active ? { triggeredAt: null, triggeredPrice: null } : {}),
        },
      });
      return { ok: true };
    }),
});
