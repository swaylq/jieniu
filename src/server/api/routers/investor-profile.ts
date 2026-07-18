import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { normalizeStyle, normalizeRisk, normalizeHold } from "~/lib/investor-profile";
import { summarizeInvestorProfile } from "~/server/ai";

/** User Memory（P4-6）：投资画像。自我认知工具，非风险测评结论、非荐股依据。 */
export const investorProfileRouter = createTRPCRouter({
  get: protectedProcedure.query(({ ctx }) =>
    ctx.db.investorProfile.findUnique({
      where: { userId: ctx.session.user.id },
      select: {
        style: true,
        riskLevel: true,
        holdPeriod: true,
        summary: true,
        updatedAt: true,
      },
    }),
  ),

  /** 保存画像问卷（部分字段安全：只更新传入的键）。 */
  save: protectedProcedure
    .input(
      z.object({
        style: z.string().nullable().optional(),
        riskLevel: z.string().nullable().optional(),
        holdPeriod: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const data: {
        style?: string | null;
        riskLevel?: string | null;
        holdPeriod?: string | null;
      } = {};
      if (input.style !== undefined) data.style = normalizeStyle(input.style);
      if (input.riskLevel !== undefined) data.riskLevel = normalizeRisk(input.riskLevel);
      if (input.holdPeriod !== undefined) data.holdPeriod = normalizeHold(input.holdPeriod);
      await ctx.db.investorProfile.upsert({
        where: { userId: ctx.session.user.id },
        create: { userId: ctx.session.user.id, ...data },
        update: data,
      });
      return { ok: true };
    }),

  /** 从决策史 AI 归纳一句画像（≥3 条才调 AI，省 token）。 */
  summarize: protectedProcedure.mutation(async ({ ctx }) => {
    const decisions = await ctx.db.decision.findMany({
      where: { userId: ctx.session.user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { action: true, reason: true, entity: { select: { name: true } } },
    });
    if (decisions.length < 3) return { summary: null as string | null, tooFew: true };
    const prof = await ctx.db.investorProfile.findUnique({
      where: { userId: ctx.session.user.id },
      select: { style: true, riskLevel: true },
    });
    const summary = await summarizeInvestorProfile({
      style: prof?.style ?? null,
      riskLevel: prof?.riskLevel ?? null,
      decisions: decisions.map((d) => ({
        action: d.action,
        reason: d.reason,
        entityName: d.entity.name,
      })),
    });
    await ctx.db.investorProfile.upsert({
      where: { userId: ctx.session.user.id },
      create: { userId: ctx.session.user.id, summary },
      update: { summary },
    });
    return { summary, tooFew: false };
  }),
});
