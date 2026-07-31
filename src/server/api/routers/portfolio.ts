import { z } from "zod";
import { nameWithCode } from "~/lib/watch-label";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { sanitizeHoldingNumbers } from "~/lib/portfolio";
import { rollUpHoldingChange } from "~/lib/portfolio-change";
import { propagateImpact } from "~/lib/impact";
import { parseAppointmentView } from "~/lib/disclosure";
import { upcomingCatalysts, type CatalystRow } from "~/lib/catalyst-window";

const num = z.number().finite().nullable().optional();

/** Portfolio Memory（P4-1）：持仓/观察两态 + 成本/仓位/目标（手录，仅观察）。建立在 Watchlist 之上。 */
export const portfolioRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.watchlist.findMany({
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
    return rows.map(({ entity, ...rest }) => ({
      ...rest,
      entity: {
        id: entity.id,
        name: entity.name,
        type: entity.type,
        ticker: entity.ticker,
        issuedTicker: entity.relFrom[0]?.to.ticker ?? null,
      },
    }));
  }),

  /**
   * 「今天你的组合变了什么」（P4-4）：按近期 thesisSignals 汇总每票逻辑增强/削弱/未变。纯 DB+rule，无 AI。
   *
   * 2026-07-31：原来只查 `status: "HOLDING"`。而首页四张状态卡就是数这个结果，
   * 于是「只加了自选、没标持仓」的用户三张卡恒为 0（三个数之和恒等于持仓数），
   * 文案还照说「你关注的投资逻辑今天都很平静」——线上 6 个账号里 3 个是这个状态，
   * 张楚寒 7 只自选从 7-05 起一次都没见过非零。观察态同样是「你在乎的逻辑」，一并算。
   */
  changed: protectedProcedure
    .input(z.object({ days: z.number().min(1).max(30).default(7) }).optional())
    .query(async ({ ctx, input }) => {
      const days = input?.days ?? 7;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const holdings = await ctx.db.watchlist.findMany({
        where: { userId: ctx.session.user.id, status: { not: "CLOSED" } },
        select: {
          entityId: true,
          status: true,
          entity: {
            select: {
              name: true,
              ticker: true,
              // 公司那份自己没有代码，借它发行股票的（张楚寒：「都加上代码吧」）
              relFrom: {
                where: { type: "ISSUES" as const },
                select: { to: { select: { ticker: true } } },
                take: 1,
              },
            },
          },
        },
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
        rollUpHoldingChange(
          h.entityId,
          // 这条链路的 name 只进展示（首页「今日你的组合变了什么」），所以直接带上代码
          nameWithCode(
            h.entity.name,
            h.entity.ticker,
            h.entity.relFrom?.[0]?.to.ticker ?? null,
          ),
          byEntity.get(h.entityId) ?? [],
          h.status === "HOLDING" ? "HOLDING" : "WATCH",
        ),
      );
    }),

  /**
   * 「催化临近」（2026-07-31）：你的自选里，未来 N 天内有**交易所预约披露日**的标的。
   *
   * 这张卡原来数的是 `upcomingDisclosureNodes(now, 2)`——写死取两个法定披露截止日，
   * 所以永远显示 2，跟用户无关、跟远近无关。改成数你自己的节点：数据来自
   * `EntitySignal(kind="disclosure")`（公司报备的确定性日程，全库 5256/5500 只有值）。
   * 自选存的常是 COMPANY 实体，而披露日挂在 STOCK 上，要顺着 ISSUES 关系找过去。
   */
  catalysts: protectedProcedure
    .input(z.object({ windowDays: z.number().min(1).max(120).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.watchlist.findMany({
        where: { userId: ctx.session.user.id, status: { not: "CLOSED" } },
        select: {
          entityId: true,
          entity: {
            select: {
              name: true,
              ticker: true,
              relFrom: {
                where: { type: "ISSUES" as const },
                select: { toId: true, to: { select: { ticker: true } } },
                take: 1,
              },
            },
          },
        },
      });
      if (rows.length === 0) return [];
      // 自己 + 它发行的股票，两个 id 都去找披露信号（COMPANY / STOCK 孪生实体）
      const lookupIds = rows.flatMap((r) => [
        r.entityId,
        ...r.entity.relFrom.map((rel) => rel.toId),
      ]);
      const signals = await ctx.db.entitySignal.findMany({
        where: { entityId: { in: lookupIds }, kind: "disclosure" },
        select: { entityId: true, detail: true },
      });
      const byId = new Map(signals.map((s) => [s.entityId, s.detail]));
      const cands: CatalystRow[] = [];
      for (const r of rows) {
        const ids = [r.entityId, ...r.entity.relFrom.map((rel) => rel.toId)];
        const detail = ids.map((id) => byId.get(id)).find((d) => d !== undefined);
        const view = parseAppointmentView(detail);
        if (!view) continue;
        cands.push({
          // 点开去的是自选里那个实体，不是股票那份——保持站内导航一致
          entityId: r.entityId,
          name: nameWithCode(
            r.entity.name,
            r.entity.ticker,
            r.entity.relFrom?.[0]?.to.ticker ?? null,
          ),
          periodLabel: view.periodLabel,
          date: view.date,
        });
      }
      return upcomingCatalysts(cands, new Date(), input?.windowDays);
    }),

  /**
   * Event 传播链（P4-9）：有异动的自选，经关系图（同板块/竞品）扩散到用户其它自选——
   * 「值得留意」的关联提示，非因果、非荐股。与 `changed` 同口径覆盖观察态（2026-07-31）。
   */
  impact: protectedProcedure
    .input(z.object({ days: z.number().min(1).max(30).default(7) }).optional())
    .query(async ({ ctx, input }) => {
      const days = input?.days ?? 7;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const holdings = await ctx.db.watchlist.findMany({
        where: { userId: ctx.session.user.id, status: { not: "CLOSED" } },
        select: {
          entityId: true,
          entity: {
            select: {
              name: true,
              ticker: true,
              // 公司那份自己没有代码，借它发行股票的（张楚寒：「都加上代码吧」）
              relFrom: {
                where: { type: "ISSUES" as const },
                select: { to: { select: { ticker: true } } },
                take: 1,
              },
            },
          },
        },
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
