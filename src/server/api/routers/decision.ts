import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { isValidReason } from "~/lib/decision";
import { asStringArray } from "~/lib/thesis";
import { driftDecision, fallbackChallenge } from "~/lib/drift";
import {
  adjustDriftLevel,
  driftToneHint,
  normalizeRisk,
} from "~/lib/investor-profile";
import { MATERIAL_ALERT_THRESHOLD } from "~/lib/thesis-status";
import { generateDriftChallenge } from "~/server/ai";
import type { Prisma } from "../../../../generated/prisma";

const actionEnum = z.enum(["BUY", "ADD", "TRIM", "SELL", "HOLD_REAFFIRM"]);

/** Decision Memory（P4-3）：记录用户自己的决策与理由。非平台建议；price 仅观察。 */
export const decisionRouter = createTRPCRouter({
  /** 某标的的决策时间线（当前用户）。 */
  listByEntity: protectedProcedure
    .input(z.object({ entityId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.decision.findMany({
        where: { userId: ctx.session.user.id, entityId: input.entityId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          action: true,
          reason: true,
          price: true,
          createdAt: true,
        },
      }),
    ),

  /** 我的最近决策（跨标的，组合页用）。 */
  listMine: protectedProcedure
    .input(z.object({ take: z.number().min(1).max(50).default(10) }).optional())
    .query(({ ctx, input }) =>
      ctx.db.decision.findMany({
        where: { userId: ctx.session.user.id },
        orderBy: { createdAt: "desc" },
        take: input?.take ?? 10,
        select: {
          id: true,
          action: true,
          reason: true,
          price: true,
          createdAt: true,
          entity: { select: { id: true, name: true } },
        },
      }),
    ),

  /** Thesis Drift Guard（P4-5）：加仓/买入前对照原始逻辑 + 近期偏风险信号，产出「挑战/确认」自查话术。
   *  事实(bull/bear 材料信号数)由 Code 从 DB 取；AI 仅在 shouldChallenge 时组织话术，不编数字。 */
  driftCheck: protectedProcedure
    .input(z.object({ entityId: z.string(), action: actionEnum }))
    .mutation(async ({ ctx, input }) => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const [entity, thesis, signals, earliest, profile] = await Promise.all([
        ctx.db.entity.findUnique({
          where: { id: input.entityId },
          select: { name: true },
        }),
        ctx.db.thesis.findUnique({
          where: { entityId: input.entityId },
          select: { summary: true, catalysts: true, invalidations: true },
        }),
        ctx.db.thesisSignal.findMany({
          where: { entityId: input.entityId, publishedAt: { gte: since } },
          select: { direction: true, materiality: true, note: true },
        }),
        ctx.db.decision.findFirst({
          where: {
            userId: ctx.session.user.id,
            entityId: input.entityId,
            action: { in: ["BUY", "ADD"] },
          },
          orderBy: { createdAt: "asc" },
          select: { reason: true },
        }),
        ctx.db.investorProfile.findUnique({
          where: { userId: ctx.session.user.id },
          select: { riskLevel: true },
        }),
      ]);
      const material = signals.filter((s) => s.materiality >= MATERIAL_ALERT_THRESHOLD);
      const bullMaterial = material.filter((s) => s.direction === "bull").length;
      const bearMaterial = material.filter((s) => s.direction === "bear").length;
      const verdict = driftDecision({
        action: input.action,
        bullMaterial,
        bearMaterial,
      });
      const facts = { bullMaterial, bearMaterial };
      if (!verdict.shouldChallenge || !thesis) {
        return { shouldChallenge: false, level: verdict.level, facts, message: null };
      }
      // 画像回灌：按风险偏好调整挑战档位与语气（激进→更强，保守→温和）。
      const risk = normalizeRisk(profile?.riskLevel);
      const level = adjustDriftLevel(verdict.level, risk);
      const name = entity?.name ?? "该股";
      const originalReason = earliest?.reason ?? thesis.summary;
      const bearNotes = material
        .filter((s) => s.direction === "bear")
        .slice(0, 3)
        .map((s) => s.note);
      let message: string;
      try {
        message = await generateDriftChallenge({
          name,
          action: input.action as "BUY" | "ADD",
          originalReason,
          catalysts: asStringArray(thesis.catalysts),
          invalidations: asStringArray(thesis.invalidations),
          recentBearNotes: bearNotes,
          level: level === "strong" ? "strong" : "soft",
          toneHint: driftToneHint(risk),
        });
      } catch {
        message = fallbackChallenge(name, originalReason);
      }
      return { shouldChallenge: true, level, facts, message };
    }),

  /** 录入一笔决策；同时快照当刻该标的 thesis，供日后 drift 对比。 */
  create: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
        action: actionEnum,
        reason: z.string().min(1).max(1000),
        price: z.number().finite().positive().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isValidReason(input.reason)) {
        throw new Error("请写下这笔决策的理由");
      }
      // 快照当刻 thesis（summary + 催化剂 + 证伪条件），作为日后 drift guard 的对照锚。
      const thesis = await ctx.db.thesis.findUnique({
        where: { entityId: input.entityId },
        select: { summary: true, catalysts: true, invalidations: true },
      });
      const snapshot: Prisma.InputJsonValue | undefined = thesis
        ? {
            summary: thesis.summary,
            catalysts: asStringArray(thesis.catalysts),
            invalidations: asStringArray(thesis.invalidations),
          }
        : undefined;
      const created = await ctx.db.decision.create({
        data: {
          userId: ctx.session.user.id,
          entityId: input.entityId,
          action: input.action,
          reason: input.reason.trim(),
          price: input.price ?? null,
          ...(snapshot !== undefined ? { thesisSnapshot: snapshot } : {}),
        },
        select: { id: true },
      });
      return { ok: true, id: created.id };
    }),
});
