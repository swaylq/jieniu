import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { mergePairedSignals } from "~/lib/entity-pair";
import { REPORT_EVENT_TYPE } from "~/lib/research-reports";
import type { PrismaClient } from "../../../../generated/prisma";

/**
 * 财报前瞻（事件页范式，借鉴富途「牛牛财报站」）。
 *
 * 富途那一页的组织单位是**一次财报事件**而不是公司：所有模块都围绕「这次业绩」，
 * 事件过完换下一期。解牛此前只有「标的页 + 时间轴」，缺一个事件前瞻的落点。
 *
 * 这里只取**已在库**的确定性数据（预约披露日 / 一致预期 / 业绩预告 / 投资逻辑），
 * 历史财报日反应走外部 K 线、在页面里单独 Suspense，不进这条关键路径。
 */

type Paired = {
  /** 传入实体自己的 id + 配对实体的 id，供按 entityId 查信号/资讯用。 */
  ids: string[];
  companyId: string | null;
  stockId: string | null;
  ticker: string | null;
};

/**
 * 解析 COMPANY ↔ STOCK 配对（`ISSUES` 关系）。
 * `Thesis` 挂 COMPANY、`EntitySignal`/行情挂 STOCK——只查单边会各丢一半。
 */
async function resolvePair(
  db: PrismaClient,
  id: string,
): Promise<Paired | null> {
  const e = await db.entity.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      ticker: true,
      relFrom: {
        where: { type: "ISSUES" },
        select: { to: { select: { id: true, type: true, ticker: true } } },
      },
      relTo: {
        where: { type: "ISSUES" },
        select: { from: { select: { id: true, type: true, ticker: true } } },
      },
    },
  });
  if (!e) return null;

  const issued = e.relFrom.map((r) => r.to); // COMPANY → STOCK
  const issuer = e.relTo.map((r) => r.from); // STOCK ← COMPANY

  const stock =
    e.type === "STOCK"
      ? { id: e.id, ticker: e.ticker }
      : (issued.find((x) => x.type === "STOCK" && x.ticker) ?? null);
  const company =
    e.type === "COMPANY"
      ? { id: e.id }
      : (issuer.find((x) => x.type === "COMPANY") ?? null);

  const ids = [
    ...new Set([e.id, stock?.id, company?.id].filter(Boolean)),
  ] as string[];
  return {
    ids,
    companyId: company?.id ?? null,
    stockId: stock?.id ?? null,
    ticker: stock?.ticker ?? e.ticker ?? null,
  };
}

export const earningsRouter = createTRPCRouter({
  /**
   * 结构化信号（配对合并版）。替代 `entity.signals` 供个股/公司页使用——后者只查单一 id，
   * 公司页因此一条信号都拿不到。
   */
  signals: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const pair = await resolvePair(ctx.db, input.id);
      if (!pair) return [];
      const rows = await ctx.db.entitySignal.findMany({
        where: { entityId: { in: pair.ids } },
        select: {
          kind: true,
          label: true,
          numValue: true,
          detail: true,
          asOf: true,
        },
      });
      return mergePairedSignals(rows);
    }),

  preview: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const pair = await resolvePair(ctx.db, input.id);
      if (!pair) return null;

      const entity = await ctx.db.entity.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          name: true,
          ticker: true,
          exchange: true,
          type: true,
        },
      });
      if (!entity) return null;

      const userId = ctx.session?.user?.id;

      const [signals, forecast, thesis, userThesis, reportCount] =
        await Promise.all([
          ctx.db.entitySignal.findMany({
            where: {
              entityId: { in: pair.ids },
              kind: { in: ["disclosure", "consensus"] },
            },
            select: {
              kind: true,
              label: true,
              numValue: true,
              detail: true,
              asOf: true,
            },
          }),
          // 最近一条业绩预告——A 股独有的强前瞻信号（富途的美股页没有对应物）。
          ctx.db.newsItem.findFirst({
            where: {
              eventType: "业绩预告",
              entities: { some: { entityId: { in: pair.ids } } },
            },
            orderBy: { publishedAt: "desc" },
            select: { id: true, title: true, summary: true, publishedAt: true },
          }),
          // Thesis 挂 COMPANY 侧
          pair.companyId
            ? ctx.db.thesis.findUnique({
                where: { entityId: pair.companyId },
                select: {
                  dimensions: true,
                  summary: true,
                  updatedAt: true,
                  model: true,
                },
              })
            : null,
          userId && pair.companyId
            ? ctx.db.userThesis.findFirst({
                where: { userId, entityId: { in: pair.ids } },
                select: { dimensions: true, reason: true, updatedAt: true },
              })
            : null,
          // 一致预期卡「看这家的机构研报」的入口条件。**只数 input.id 这一侧**，不数 pair.ids：
          // 链接落到 /entity/{input.id}?tab=report，而那个 tab 也只查这一个实体——
          // 用配对口径会数出比目的地更多的篇数，甚至给零研报的一侧开出空链接。
          ctx.db.newsItem.count({
            where: {
              eventType: REPORT_EVENT_TYPE,
              entities: { some: { entityId: input.id } },
            },
          }),
        ]);

      const merged = mergePairedSignals(signals);
      return {
        entity,
        ticker: pair.ticker,
        disclosure: merged.find((s) => s.kind === "disclosure") ?? null,
        consensus: merged.find((s) => s.kind === "consensus") ?? null,
        forecast,
        thesis,
        userThesis,
        reportCount,
      };
    }),
});
