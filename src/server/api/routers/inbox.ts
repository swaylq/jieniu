import { randomBytes } from "crypto";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

/**
 * 站内 inbox（最新推送）。读的是 AlertEvent（Outbox）——**真正被投递过的事实**，
 * 与提醒中心原有的三个派生区互补：那三个是「现在查得到什么」，这里是「发生过什么、告诉过你没有」。
 * 站内不限流（它就是提醒中心）；限流只作用在站外投递（见 lib/alert-outbox 的 selectForDelivery）。
 */
export const inboxRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(30) }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.db.alertEvent.findMany({
        where: { userId: ctx.session.user.id },
        orderBy: { occurredAt: "desc" },
        take: input?.limit ?? 30,
        select: {
          id: true,
          kind: true,
          title: true,
          body: true,
          url: true,
          occurredAt: true,
          priority: true,
          readAt: true,
          emailedAt: true,
        },
      });
    }),

  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.alertEvent.count({
      where: { userId: ctx.session.user.id, readAt: null },
    });
  }),

  /** 标记已读：不传 id 则全部标已读。已读水位按事件本身走，与站外投递解耦。 */
  markRead: protectedProcedure
    .input(z.object({ id: z.string().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      await ctx.db.alertEvent.updateMany({
        where: {
          userId: ctx.session.user.id,
          readAt: null,
          ...(input?.id ? { id: input.id } : {}),
        },
        data: { readAt: now },
      });
      return { ok: true };
    }),

  /** 邮件投递开关。默认关——存量用户不会突然收信。 */
  emailPref: protectedProcedure.query(async ({ ctx }) => {
    const u = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { alertEmail: true, email: true },
    });
    return { enabled: u?.alertEmail ?? false, email: u?.email ?? null };
  }),

  setEmailPref: protectedProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const u = await ctx.db.user.findUnique({
        where: { id: userId },
        select: { alertEmailToken: true },
      });
      // 开启时才铸退订令牌（免登录退订链接用），一次铸成、之后复用。
      const token =
        u?.alertEmailToken ??
        (input.enabled ? randomBytes(24).toString("base64url") : null);
      await ctx.db.user.update({
        where: { id: userId },
        data: { alertEmail: input.enabled, alertEmailToken: token },
      });
      return { enabled: input.enabled };
    }),
});
