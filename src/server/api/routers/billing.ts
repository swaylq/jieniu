import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { normalizePlan, type PlanTier } from "~/lib/plan";

/** 分层（Phase 3 P3-7）：读用户档位。支付暂占位，升级入口在 /plus。 */
export const billingRouter = createTRPCRouter({
  myPlan: protectedProcedure.query(async ({ ctx }): Promise<PlanTier> => {
    const user = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { plan: true },
    });
    return normalizePlan(user?.plan);
  }),
});
