import { cache } from "react";

import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { resolveAvatar, type ResolvedAvatar } from "~/lib/avatar";

/**
 * 当前登录用户的头像（已判定好优先级，可直接丢给 `UserAvatar`）。
 *
 * 为什么从库里读而不是塞进 JWT：session 走 `jwt` 策略、回调里只带 `id`，而客户端没有
 * `SessionProvider`（`useSession().update()` 用不了），塞进 token 就意味着改完头像要等下次
 * 登录才生效。`cache()` 让 layout 与页面在同一次渲染里只查一次（主键取四列，~1ms）；
 * 写完 `router.refresh()`，全站立刻换新。
 */
export const getViewerAvatar = cache(
  async (): Promise<ResolvedAvatar | null> => {
    const session = await auth();
    const id = session?.user?.id;
    if (!id) return null;
    const u = await db.user.findUnique({
      where: { id },
      select: { email: true, image: true, avatarColor: true, avatarChar: true },
    });
    if (!u) return null;
    return resolveAvatar(u, u.email ?? session.user.email ?? null);
  },
);
