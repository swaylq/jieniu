import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { sanitizeHoldingNumbers } from "~/lib/portfolio";
import { rollUpHoldingChange } from "~/lib/portfolio-change";
import { propagateImpact } from "~/lib/impact";

const num = z.number().finite().nullable().optional();

/** Portfolio Memory（P4-1）：持仓/观察两态 + 成本/仓位/目标（手录，仅观察）。建立在 Watchlist 之上。 */
export const portfolioRouter = createTRPCRouter({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.db.watchlist.findMany({
      where: { userId: ctx.session.user.id },
      orderBy: [{ weight: "desc" }, { createdAt: "desc" }],
      select: {
        status: true,
        costBasis: true,
        shares: true,
        weight: true,
        targetWeight: true,
        note: true,
        createdAt: true,
        entity: { select: { id: true, name: true, type: true, ticker: true } },
      },
    }),
  ),

  /** 「今天你的组合变了什么」（P4-4）：仅持仓，按近期 thesisSignals 汇总每票逻辑增强/削弱/未变。纯 DB+rule，无 AI。 */
  changed: protectedProcedure
    .input(z.object({ days: z.number().min(1).max(30).default(7) }).optional())
    .query(async ({ ctx, input }) => {
      const days = input?.days ?? 7;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const holdings = await ctx.db.watchlist.findMany({
        where: { userId: ctx.session.user.id, status: "HOLDING" },
        select: { entityId: true, entity: { select: { name: true } } },
      });
      if (holdings.length === 0) return [];
      const entityIds = holdings.map((h) => h.entityId);
      const signals = await ctx.db.thesisSignal.findMany({
        where: { entityId: { in: entityIds }, publishedAt: { gte: since } },
        orderBy: { publishedAt: "desc" },
        select: {
          entityId: true,
          dimensionKey: true,
          direction: true,
          materiality: true,
          note: true,
        },
      });
      const byEntity = new Map<string, typeof signals>();
      for (const s of signals) {
        const arr = byEntity.get(s.entityId) ?? [];
        arr.push(s);
        byEntity.set(s.entityId, arr);
      }
      return holdings.map((h) =>
        rollUpHoldingChange(h.entityId, h.entity.name, byEntity.get(h.entityId) ?? []),
      );
    }),

  /** Event 传播链（P4-9）：有异动的持仓，经关系图（同板块/竞品）扩散到用户其它持仓——「值得留意」的关联提示，非因果、非荐股。 */
  impact: protectedProcedure
    .input(z.object({ days: z.number().min(1).max(30).default(7) }).optional())
    .query(async ({ ctx, input }) => {
      const days = input?.days ?? 7;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const holdings = await ctx.db.watchlist.findMany({
        where: { userId: ctx.session.user.id, status: "HOLDING" },
        select: { entityId: true, entity: { select: { name: true } } },
      });
      if (holdings.length < 2) return []; // 传播需要 ≥2 持仓才有意义
      const holdingIds = holdings.map((h) => h.entityId);
      const nameById = new Map(holdings.map((h) => [h.entityId, h.entity.name]));
      const [signals, edges] = await Promise.all([
        ctx.db.thesisSignal.findMany({
          where: { entityId: { in: holdingIds }, publishedAt: { gte: since } },
          orderBy: { publishedAt: "desc" },
          select: { entityId: true, dimensionKey: true, direction: true, materiality: true, note: true },
        }),
        ctx.db.entityRelation.findMany({
          where: {
            OR: [
              { fromId: { in: holdingIds }, type: "BELONGS_TO" },
              { type: "RELATED", OR: [{ fromId: { in: holdingIds } }, { toId: { in: holdingIds } }] },
            ],
          },
          select: { fromId: true, toId: true, type: true },
        }),
      ]);
      const byEntity = new Map<string, typeof signals>();
      for (const s of signals) {
        const arr = byEntity.get(s.entityId) ?? [];
        arr.push(s);
        byEntity.set(s.entityId, arr);
      }
      // 源 = 有异动（逻辑增强/削弱）的持仓
      const changed = holdings
        .map((h) => rollUpHoldingChange(h.entityId, h.entity.name, byEntity.get(h.entityId) ?? []))
        .filter((c) => c.direction !== "unchanged");
      if (changed.length === 0) return [];
      return changed
        .map((src) => ({
          sourceEntityId: src.entityId,
          sourceName: src.name,
          direction: src.direction,
          impacted: propagateImpact(src.entityId, edges, holdingIds)
            .filter((h) => nameById.has(h.entityId))
            .map((h) => ({ entityId: h.entityId, name: nameById.get(h.entityId) ?? "", path: h.path })),
        }))
        .filter((r) => r.impacted.length > 0);
    }),

  /** 取单条（编辑器回填）。未关注则 null。 */
  get: protectedProcedure
    .input(z.object({ entityId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.watchlist.findUnique({
        where: {
          userId_entityId: { userId: ctx.session.user.id, entityId: input.entityId },
        },
        select: {
          status: true,
          costBasis: true,
          shares: true,
          weight: true,
          targetWeight: true,
          note: true,
        },
      }),
    ),

  /** 标记/更新持仓：设置状态 + 成本/仓位/目标（自动清洗为合法值）。若尚未关注则一并建立（=关注）。 */
  upsert: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
        status: z.enum(["WATCH", "HOLDING", "CLOSED"]),
        costBasis: num,
        shares: num,
        weight: num,
        targetWeight: num,
        note: z.string().max(500).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const nums = sanitizeHoldingNumbers(input);
      const note = input.note?.trim() ? input.note.trim() : null;
      await ctx.db.watchlist.upsert({
        where: {
          userId_entityId: { userId: ctx.session.user.id, entityId: input.entityId },
        },
        create: {
          userId: ctx.session.user.id,
          entityId: input.entityId,
          status: input.status,
          ...nums,
          note,
        },
        update: { status: input.status, ...nums, note },
      });
      return { ok: true, status: input.status };
    }),
});
