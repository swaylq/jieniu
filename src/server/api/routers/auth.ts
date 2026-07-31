import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { env } from "~/env";
import { generateCode, hashCode, OTP_TTL_MS } from "~/lib/otp";
import { sendVerificationEmail } from "~/server/email";
import { sendVerificationSms, smsConfigured } from "~/server/sms";
import { isValidPhone, normalizePhone, maskPhone, phoneIdentifier } from "~/lib/phone";
import { verifyOtpCode, verifyPhoneOtpCode } from "~/server/otp-verify";
import { rateLimit, clientIp } from "~/lib/rate-limit";

const emailInput = z.object({ email: z.string().email() });
const phoneInput = z.object({ phone: z.string().min(6).max(20) });

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

  /** 手机号登录是否可用（签名没配就不显示这一档，别让用户点了才发现发不出）。 */
  smsAvailable: publicProcedure.query(() => ({ available: smsConfigured() })),

  /**
   * 手机号验证码（张楚寒转述她爹：「登陆怎么还要邮箱啊」「手机号登陆不好吗」）。
   * 限流口径与邮箱那条完全一致——**而且这条更要紧**：短信是花钱的，且轰炸的是真人的手机。
   */
  requestSmsOtp: publicProcedure
    .input(phoneInput)
    .mutation(async ({ ctx, input }) => {
      if (!smsConfigured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "手机号登录暂未开放，请用邮箱登录。",
        });
      }
      if (!isValidPhone(input.phone)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "请输入正确的中国大陆手机号。",
        });
      }
      const phone = normalizePhone(input.phone);
      const identifier = phoneIdentifier(phone);
      const ip = clientIp(ctx.headers);

      if (!rateLimit(`otp:send:${identifier}`, 1, 60_000)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "请 60 秒后再获取验证码。",
        });
      }
      if (!rateLimit(`otp:send:h:${identifier}`, 5, HOUR_MS)) {
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
      await ctx.db.verificationToken.deleteMany({ where: { identifier } });
      await ctx.db.verificationToken.create({
        data: {
          identifier,
          token: hashCode(`${identifier}:${code}`),
          expires: new Date(Date.now() + OTP_TTL_MS),
        },
      });

      const delivered = await sendVerificationSms(phone, code);
      // 发失败就把码删掉并报错——别让用户空等一条从没发出的短信（同邮箱那条的立场）
      if (!delivered && env.NODE_ENV === "production") {
        await ctx.db.verificationToken.deleteMany({ where: { identifier } });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "验证码发送失败，请稍后重试或改用邮箱登录。",
        });
      }
      return {
        sent: true,
        masked: maskPhone(phone),
        devCode: !delivered && env.NODE_ENV !== "production" ? code : undefined,
      };
    }),

  verifySmsOtp: publicProcedure
    .input(phoneInput.extend({ code: z.string().length(6) }))
    .mutation(async ({ ctx, input }) => {
      const identifier = phoneIdentifier(input.phone);
      const ip = clientIp(ctx.headers);
      if (!rateLimit(`otp:verify:ip:${ip}`, 30, HOUR_MS)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "尝试过于频繁，请稍后再试。",
        });
      }
      if (!rateLimit(`otp:verify:${identifier}`, 10, HOUR_MS)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "尝试过于频繁，请稍后再试。",
        });
      }
      return verifyPhoneOtpCode(ctx.db, input.phone, input.code);
    }),
});
