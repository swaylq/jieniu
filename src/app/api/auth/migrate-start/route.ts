import { encode } from "next-auth/jwt";
import { NextResponse } from "next/server";

import {
  MIGRATION_TTL,
  NEW_ORIGIN,
  SESSION_COOKIE,
  sanitizeNextPath,
} from "~/lib/session-migrate";
import { auth } from "~/server/auth";

export const dynamic = "force-dynamic";

// 老域名专属：读会话 → 已登录则签发一次性迁移令牌去新域名；未登录直接去新域名。
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET;
  const url = new URL(req.url);
  const next = sanitizeNextPath(url.searchParams.get("next"));

  if (!secret) {
    return NextResponse.redirect(new URL("/", NEW_ORIGIN), 302);
  }

  const session = await auth();
  if (session?.user?.id) {
    const token = await encode({
      token: { sub: session.user.id },
      secret,
      salt: SESSION_COOKIE,
      maxAge: MIGRATION_TTL,
    });
    const target = new URL("/api/auth/migrate", NEW_ORIGIN);
    target.searchParams.set("token", token);
    if (next !== "/") target.searchParams.set("next", next);
    return NextResponse.redirect(target, 302);
  }

  return NextResponse.redirect(new URL(next, NEW_ORIGIN), 302);
}
