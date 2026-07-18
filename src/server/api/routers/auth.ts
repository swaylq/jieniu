import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { env } from "~/env";
import { generateCode, hashCode, OTP_TTL_MS } from "~/lib/otp";
import { sendVerificationEmail } from "~/server/email";
import { verifyOtpCode } from "~/server/otp-verify";
import { rateLimit, clientIp } from "~/lib/rate-limit";

const emailInput = z.object({ email: z.string().email() });

const HOUR_MS = 60 * 60 * 1000;

export const authRouter = createTRPCRouter({
  /** 生成验证码 → 存哈希到 VerificationToken → 发邮件。 */
  requestOtp: publicProcedure
    .input(emailInput)
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase();
      const ip = clientIp(ctx.headers);

      // 限流：60 秒重发冷却 + 每邮箱每小时上限 + 每 IP 每小时上限。
      // 挡验证码轰炸（骚扰他人邮箱）与批量刷发。
      if (!rateLimit(`otp:send:${email}`, 1, 60_000)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "请 60 秒后再获取验证码。",
        });
      }
      if (!rateLimit(`otp:send:h:${email}`, 5, HOUR_MS)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "验证码请求过于频繁，请稍后再试。",
        });
      }
      if (!rateLimit(`otp:send:ip:${ip}`, 20, HOUR_MS)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "请求过于频繁，请稍后再试。",
        });
      }

      const code = generateCode();

      await ctx.db.verificationToken.deleteMany({
        where: { identifier: email },
      });
      await ctx.db.verificationToken.create({
        data: {
          identifier: email,
          token: hashCode(`${email}:${code}`),
          expires: new Date(Date.now() + OTP_TTL_MS),
        },
      });

      const delivered = await sendVerificationEmail(email, code);
      // 生产环境发信失败：删掉刚建的码并显式报错，别让用户空等一个从没发出的码。
      if (!delivered && env.NODE_ENV === "production") {
        await ctx.db.verificationToken.deleteMany({
          where: { identifier: email },
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "验证码发送失败，请稍后重试。",
        });
      }
      return {
        sent: true,
        devCode:
          !delivered && env.NODE_ENV !== "production" ? code : undefined,
      };
    }),

  /** 校验验证码 → 消费 token → upsert User。（会话由 NextAuth Credentials 建立。） */
  verifyOtp: publicProcedure
    .input(emailInput.extend({ code: z.string().length(6) }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase();
      const ip = clientIp(ctx.headers);

      // 限流：每 IP / 每邮箱每小时的校验尝试上限（配合 otp-verify 里每码 5 次的持久兜底）。
      if (!rateLimit(`otp:verify:ip:${ip}`, 30, HOUR_MS)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "尝试过于频繁，请稍后再试。",
        });
      }
      if (!rateLimit(`otp:verify:${email}`, 10, HOUR_MS)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "尝试过于频繁，请稍后再试。",
        });
      }

      return verifyOtpCode(ctx.db, input.email, input.code);
    }),
});
