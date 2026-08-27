import { decode, encode } from "next-auth/jwt";
import { NextResponse } from "next/server";

import {
  NEW_ORIGIN,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  sanitizeNextPath,
} from "~/lib/session-migrate";

export const dynamic = "force-dynamic";

// 新域名专属：消费老域名签发的一次性迁移令牌，重签 30 天会话 cookie 落在 jieniu.club。
export async function GET(req: Request) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return new NextResponse("migrate unavailable", { status: 500 });

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return new NextResponse("missing token", { status: 400 });

  let sub: string | undefined;
  try {
    const payload = await decode({ token, secret, salt: SESSION_COOKIE });
    sub = payload?.sub;
  } catch {
    sub = undefined;
  }
  if (!sub) return new NextResponse("invalid or expired token", { status: 400 });

  const sessionToken = await encode({
    token: { sub },
    secret,
    salt: SESSION_COOKIE,
    maxAge: SESSION_MAX_AGE,
  });

  // 回跳地址钉死用 NEW_ORIGIN，别从 req.url 推导——
  // 回源走 nginx 时 Next 会把 origin 探成 localhost:3838，重定向会落到打不开的地址。
  const res = NextResponse.redirect(
    new URL(sanitizeNextPath(url.searchParams.get("next")), NEW_ORIGIN),
    303,
  );
  res.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: true,
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
