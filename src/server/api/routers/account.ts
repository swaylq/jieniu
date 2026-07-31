import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { hashPassword, verifyPassword, isValidPassword } from "~/lib/password";
import {
  avatarUrl,
  clampColorIndex,
  normalizeAvatarChar,
  AVATAR_CHAR_MAX,
} from "~/lib/avatar";
import { AVATAR_GRADIENTS } from "~/lib/brand";
import {
  decodeImageDataUrl,
  deleteAvatarImage,
  saveAvatarImage,
} from "~/server/avatar-store";

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

  /** 编辑器读当前头像设置（渲染用的判定在服务端 `getViewerAvatar`，这里只给原始值）。 */
  getAvatar: protectedProcedure.query(async ({ ctx }) => {
    const u = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { email: true, image: true, avatarColor: true, avatarChar: true },
    });
    return {
      image: u?.image ?? null,
      avatarColor: u?.avatarColor ?? null,
      avatarChar: u?.avatarChar ?? null,
      seed: u?.email ?? null,
    };
  }),

  /**
   * 设置头像。三种状态互斥，所以用判别联合写进类型里，而不是靠一堆可选字段 + 散文约定。
   *
   * - `image`：客户端裁好的正方形图（dataURL）→ 服务端二次把关 + 转码 → 落盘
   * - `preset`：选色 / 改字，**同时清掉照片**（否则照片优先，用户改了半天没反应）
   * - `reset`：回到按邮箱散列的默认头像
   */
  setAvatar: protectedProcedure
    .input(
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("image"), dataUrl: z.string().max(6_000_000) }),
        z.object({
          kind: z.literal("preset"),
          color: z.number().int().nullable(),
          char: z.string().max(64).nullable(),
        }),
        z.object({ kind: z.literal("reset") }),
      ]),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      if (input.kind === "image") {
        // 不信客户端声明的 MIME，只认魔数；转码本身又是一道消毒（畸形文件在这里抛）。
        const raw = decodeImageDataUrl(input.dataUrl);
        if (!raw) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "这张图读不出来，请换 JPG / PNG",
          });
        }
        let version: string;
        try {
          ({ version } = await saveAvatarImage(userId, raw));
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "这张图读不出来，请换 JPG / PNG",
          });
        }
        const url = avatarUrl(userId, version);
        try {
          await ctx.db.user.update({
            where: { id: userId },
            data: { image: url },
          });
        } catch (err) {
          // 补偿：库没记上，磁盘上那张就是孤儿，删掉——宁可没有，别留下没人引用的文件。
          await deleteAvatarImage(userId);
          throw err;
        }
        return { ok: true as const, image: url };
      }

      if (input.kind === "preset") {
        const color = clampColorIndex(input.color);
        if (input.color !== null && color === null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `色号需在 0–${AVATAR_GRADIENTS.length - 1}`,
          });
        }
        const char = normalizeAvatarChar(input.char);
        if (input.char !== null && input.char.trim() !== "" && char === null) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `显示字符最多 ${AVATAR_CHAR_MAX} 个`,
          });
        }
        await deleteAvatarImage(userId);
        await ctx.db.user.update({
          where: { id: userId },
          data: { image: null, avatarColor: color, avatarChar: char },
        });
        return { ok: true as const, image: null };
      }

      await deleteAvatarImage(userId);
      await ctx.db.user.update({
        where: { id: userId },
        data: { image: null, avatarColor: null, avatarChar: null },
      });
      return { ok: true as const, image: null };
    }),
});
