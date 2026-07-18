import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { hashPassword, verifyPassword, isValidPassword } from "~/lib/password";

/** 账号体系（U-3）：密码设置/修改。密码登录在 NextAuth `password` provider。 */
export const accountRouter = createTRPCRouter({
  /** 当前账号是否已设密码（决定「设置」还是「修改」文案）。 */
  hasPassword: protectedProcedure.query(async ({ ctx }) => {
    const u = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { password: true },
    });
    return { hasPassword: !!u?.password };
  }),

  /** 设置或修改密码：已有密码则须校验当前密码；未设过（OTP 用户）则凭登录态直接设。 */
  setPassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string().optional(),
        newPassword: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isValidPassword(input.newPassword)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "密码需 8–128 位",
        });
      }
      const u = await ctx.db.user.findUnique({
        where: { id: ctx.session.user.id },
        select: { password: true },
      });
      if (u?.password) {
        const ok =
          typeof input.currentPassword === "string" &&
          (await verifyPassword(input.currentPassword, u.password));
        if (!ok) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "当前密码不正确",
          });
        }
      }
      const hash = await hashPassword(input.newPassword);
      await ctx.db.user.update({
        where: { id: ctx.session.user.id },
        data: { password: hash },
      });
      return { ok: true };
    }),
});
