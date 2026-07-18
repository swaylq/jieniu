import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "../../../../generated/prisma";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { type ThesisDimension } from "~/lib/thesis";
import {
  adoptDimensions,
  normalizeUserDimensions,
  activationBackfill,
} from "~/lib/user-thesis";

const dimensionInput = z.object({
  key: z.string().min(1).max(60),
  watch: z.string().max(500).default(""),
  bull: z.string().max(500).default(""),
  bear: z.string().max(500).default(""),
  priority: z.boolean().default(false),
  sensitivity: z.enum(["low", "normal", "high"]).default("normal"),
  muted: z.boolean().default(false),
  source: z.enum(["base", "user"]).default("user"),
});

const asJson = (dims: unknown) => dims as Prisma.InputJsonValue;

/**
 * 用户自有投资逻辑（S1）。共享 Thesis 是 AI 基础框架；用户「采纳」后拥有一份可编辑副本，
 * 监控在读取层按其维度选择/重点/敏感度/静音个性化。全部按 session user 隔离。
 */
export const userThesisRouter = createTRPCRouter({
  /** 取当前用户对某标的的自有逻辑；未采纳则 null。 */
  get: protectedProcedure
    .input(z.object({ entityId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.userThesis.findUnique({
        where: {
          userId_entityId: {
            userId: ctx.session.user.id,
            entityId: input.entityId,
          },
        },
      }),
    ),

  /**
   * 激活回填演示（S2 onboarding）：采纳后立刻展示「过去 N 天，有几条动态触及你为该标的选的逻辑维度、
   * 其中几条会提醒」——一次会话内证明价值，不用等新事件。未采纳则返回 null。
   */
  activationDemo: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
        days: z.number().min(1).max(90).default(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const [ut, entity] = await Promise.all([
        ctx.db.userThesis.findUnique({
          where: { userId_entityId: { userId, entityId: input.entityId } },
        }),
        ctx.db.entity.findUnique({
          where: { id: input.entityId },
          select: { name: true },
        }),
      ]);
      if (!ut) return null;
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const signals = await ctx.db.thesisSignal.findMany({
        where: { entityId: input.entityId, publishedAt: { gte: since } },
        orderBy: [{ materiality: "desc" }, { publishedAt: "desc" }],
        take: 60,
        select: {
          dimensionKey: true,
          direction: true,
          materiality: true,
          note: true,
          newsTitle: true,
        },
      });
      const dims = normalizeUserDimensions(ut.dimensions as unknown as unknown[]);
      return {
        entityName: entity?.name ?? "",
        days: input.days,
        ...activationBackfill(dims, signals),
      };
    }),

  /** 采纳：从共享 base Thesis 快照维度，建立用户自有逻辑。已采纳则不覆盖编辑（用 reset 重置）。 */
  adopt: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
        reason: z.string().max(500).nullable().optional(),
        horizon: z.enum(["long", "swing"]).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const base = await ctx.db.thesis.findUnique({
        where: { entityId: input.entityId },
      });
      if (!base) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "该标的暂无基础逻辑框架，无法采纳。",
        });
      }
      const dims = adoptDimensions(
        (base.dimensions as unknown as ThesisDimension[]) ?? [],
      );
      const userId = ctx.session.user.id;
      const reason = input.reason?.trim() ? input.reason.trim() : null;
      await ctx.db.userThesis.upsert({
        where: { userId_entityId: { userId, entityId: input.entityId } },
        create: {
          userId,
          entityId: input.entityId,
          reason,
          horizon: input.horizon ?? null,
          dimensions: asJson(dims),
          baseModel: base.model ?? null,
        },
        update: {}, // 幂等：已采纳不动，避免覆盖用户编辑
      });
      return { ok: true };
    }),

  /** 编辑：覆盖 reason/horizon/dimensions。 */
  update: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
        reason: z.string().max(500).nullable().optional(),
        horizon: z.enum(["long", "swing"]).nullable().optional(),
        dimensions: z.array(dimensionInput).min(1).max(30),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const dims = normalizeUserDimensions(input.dimensions);
      if (dims.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "至少保留一个维度。",
        });
      }
      const reason = input.reason?.trim() ? input.reason.trim() : null;
      try {
        await ctx.db.userThesis.update({
          where: { userId_entityId: { userId, entityId: input.entityId } },
          data: {
            reason,
            // horizon 省略时不动（避免每次保存把它清空）
            ...(input.horizon !== undefined ? { horizon: input.horizon } : {}),
            dimensions: asJson(dims),
          },
        });
      } catch {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "尚未采纳该标的逻辑，无法编辑。",
        });
      }
      return { ok: true };
    }),

  /** 恢复默认：从当前 base 重新快照，弃编辑。 */
  reset: protectedProcedure
    .input(z.object({ entityId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const base = await ctx.db.thesis.findUnique({
        where: { entityId: input.entityId },
      });
      if (!base) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "无基础框架可恢复。",
        });
      }
      const dims = adoptDimensions(
        (base.dimensions as unknown as ThesisDimension[]) ?? [],
      );
      try {
        await ctx.db.userThesis.update({
          where: { userId_entityId: { userId, entityId: input.entityId } },
          data: { dimensions: asJson(dims), baseModel: base.model ?? null },
        });
      } catch {
        throw new TRPCError({ code: "NOT_FOUND", message: "尚未采纳。" });
      }
      return { ok: true };
    }),

  /** 取消采纳：删除用户逻辑，回到 base 视图。 */
  remove: protectedProcedure
    .input(z.object({ entityId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.userThesis.deleteMany({
        where: { userId: ctx.session.user.id, entityId: input.entityId },
      });
      return { ok: true };
    }),
});
