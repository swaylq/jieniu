import { NextResponse, type NextRequest } from "next/server";

import { OLD_DOMAINS } from "~/lib/session-migrate";

// 老域名上的页面请求，一律引到一次性迁移入口。
// 这里不碰 AUTH_SECRET（middleware 是 edge 运行时，运行时环境变量不可靠），
// 真正的会话读取 + 签发令牌放在 Node 运行时的 /api/auth/migrate-start 里做。
export function middleware(req: NextRequest) {
  const host = req.headers.get("host")?.toLowerCase() ?? "";
  if (!OLD_DOMAINS.has(host)) return NextResponse.next();

  const url = new URL("/api/auth/migrate-start", req.url);
  const next = req.nextUrl.pathname + req.nextUrl.search;
  if (next && next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url, 302);
}

export const config = {
  // 只拦页面导航，放过 _next 静态、api、带点的静态文件（favicon/sw.js/robots 等）。
  matcher: ["/((?!_next/|api/|.*\\..*).*)"],
};
