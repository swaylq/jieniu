import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { buildAskContext, type AskMemory } from "~/lib/ask-context";
import { answerUserQuestion } from "~/server/ai";
import { isCompliant, withDisclaimer } from "~/lib/compliance";
import { MATERIAL_ALERT_THRESHOLD } from "~/lib/thesis-status";

/**
 * 「问解牛」（P5-5）——全局、结合用户四层 Memory 的私人投研问答。
 * AI 只在用户**显式提问**时调用（省 token 合规）；答案过合规过滤 + 附免责声明。
 * 回答下方的「记为投资笔记」写回 Decision（action=NOTE），让问答能沉淀进系统记忆。
 */
export const askRouter = createTRPCRouter({
  answer: protectedProcedure
    .input(z.object({ question: z.string().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      const q = input.question.trim();
      if (q.length === 0)
        throw new TRPCError({ code: "BAD_REQUEST", message: "问题不能为空" });

      const uid = ctx.session.user.id;
      const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

      const [profile, watchRows] = await Promise.all([
        ctx.db.investorProfile.findUnique({
          where: { userId: uid },
          select: { style: true, riskLevel: true, summary: true },
        }),
        ctx.db.watchlist.findMany({
          where: { userId: uid },
          orderBy: [{ weight: "desc" }, { createdAt: "desc" }],
          select: {
            entityId: true,
            status: true,
            costBasis: true,
            weight: true,
            note: true,
            entity: { select: { name: true, ticker: true } },
          },
        }),
      ]);

      const entityIds = watchRows.map((w) => w.entityId);
      const nameById = new Map(
        watchRows.map((w) => [w.entityId, w.entity.name]),
      );

      const [theses, signals, decisions] =
        entityIds.length > 0
          ? await Promise.all([
              ctx.db.thesis.findMany({
                where: { entityId: { in: entityIds } },
                select: { entityId: true, summary: true },
              }),
              ctx.db.thesisSignal.findMany({
                where: {
                  entityId: { in: entityIds },
                  publishedAt: { gte: since },
                  materiality: { gte: MATERIAL_ALERT_THRESHOLD },
                },
                orderBy: { materiality: "desc" },
                take: 12,
                select: {
                  entityId: true,
                  dimensionKey: true,
                  direction: true,
                  materiality: true,
                  note: true,
                },
              }),
              ctx.db.decision.findMany({
                where: { userId: uid },
                orderBy: { createdAt: "desc" },
                take: 5,
                select: { action: true, reason: true, entityId: true },
              }),
            ])
          : [[], [], []];

      const mem: AskMemory = {
        profile: profile ?? null,
        holdings: watchRows.map((w) => ({
          entityId: w.entityId,
          name: w.entity.name,
          ticker: w.entity.ticker,
          status: w.status,
          costBasis: w.costBasis,
          weight: w.weight,
          note: w.note,
        })),
        theses: theses.map((t) => ({
          name: nameById.get(t.entityId) ?? "",
          summary: t.summary,
        })),
        signals: signals.map((s) => ({
          name: nameById.get(s.entityId) ?? "",
          dimensionKey: s.dimensionKey,
          direction: s.direction,
          materiality: s.materiality,
          note: s.note,
        })),
        decisions: decisions.map((d) => ({
          name: nameById.get(d.entityId) ?? "",
          action: d.action,
          reason: d.reason,
        })),
      };

      const built = buildAskContext(mem);

      let raw: string;
      try {
        raw = await answerUserQuestion({
          question: q,
          context: built.contextText,
          hasMemory: built.hasMemory,
        });
      } catch {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "解牛暂时无法作答，请稍后再试。",
        });
      }

      const safe = isCompliant(raw)
        ? raw
        : "抱歉，这个回答在合规检查中被拦截了，暂不展示。可以换个问法，或直接查看相关资讯原文。";

      return {
        answer: withDisclaimer(safe),
        grounding: {
          holdings: built.groundedHoldings,
          theses: built.groundedTheses,
          hasMemory: built.hasMemory,
        },
      };
    }),

  /** 写回：把这条问答的要点记为某持仓的投资笔记（Decision action=NOTE，仅观察、非交易）。 */
  saveNote: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
        note: z.string().min(1).max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const created = await ctx.db.decision.create({
        data: {
          userId: ctx.session.user.id,
          entityId: input.entityId,
          action: "NOTE",
          reason: input.note.trim(),
        },
        select: { id: true },
      });
      return { ok: true, id: created.id };
    }),
});
