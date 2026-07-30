/**
 * measure-nav.ts —— 量「页面切换」的真实耗时（UI 性能回归用）。
 *
 * 客户端点 <Link> 时发的是带 `RSC: 1` 头的导航请求；这个脚本铸一个本地 session cookie
 * （`next-auth/jwt` 的 encode，salt = cookie 名），对每条路由重复请求，报 TTFB / 总时长 / 载荷大小。
 * 「页面切换慢」先量再改，别凭感觉。
 *
 * 用法：env DATABASE_URL="postgresql://mac@localhost:5432/jieniu" npx tsx scripts/measure-nav.ts [路由...]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { encode } from "next-auth/jwt";

import { PrismaClient } from "../generated/prisma";

const ROOT = join(import.meta.dirname, "..");
const BASE = process.env.BASE ?? "http://127.0.0.1:3838";
const EMAIL = process.env.EMAIL ?? "swaylq0913@gmail.com";
const COOKIE = "authjs.session-token";

/** 从 .env 里捞一个 key（脚本自用，不进运行时）。 */
function fromEnvFile(key: string): string | undefined {
  try {
    const txt = readFileSync(join(ROOT, ".env"), "utf8");
    const m = new RegExp(`^${key}=(.*)$`, "m").exec(txt);
    return m?.[1]?.trim().replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}

async function main() {
  const db = new PrismaClient();
  const user = await db.user.findUnique({ where: { email: EMAIL } });
  await db.$disconnect();
  if (!user) throw new Error(`找不到用户 ${EMAIL}`);

  const secret = process.env.AUTH_SECRET ?? fromEnvFile("AUTH_SECRET");
  if (!secret) throw new Error("缺 AUTH_SECRET（env 或 .env 都没有）");

  const token = await encode({
    token: { sub: user.id, email: user.email, name: user.name },
    secret,
    salt: COOKIE,
    maxAge: 3600,
  });
  const cookie = `${COOKIE}=${token}`;

  const routes = process.argv.slice(2).length
    ? process.argv.slice(2)
    : ["/", "/feed", "/discover", "/notifications", "/profile", "/settings"];

  const rounds = Number(process.env.ROUNDS ?? 3);
  console.log("路由                     轮次   TTFB      总时长     载荷   状态");
  const summary: Record<string, number[]> = {};
  for (const r of routes) {
    summary[r] = [];
    for (let i = 0; i < rounds; i++) {
      const t0 = performance.now();
      const res = await fetch(`${BASE}${r}`, {
        headers: {
          cookie,
          RSC: "1",
          "Next-Router-State-Tree": "%5B%22%22%2C%7B%7D%5D",
        },
      });
      const ttfb = performance.now() - t0;
      const body = await res.text();
      const total = performance.now() - t0;
      summary[r]!.push(total);
      console.log(
        `${r.padEnd(24)} ${String(i + 1).padEnd(5)} ${ttfb.toFixed(0).padStart(6)}ms  ${total.toFixed(0).padStart(7)}ms  ${(body.length / 1024).toFixed(0).padStart(5)}KB  ${res.status}`,
      );
    }
  }
  console.log("\n中位数（总时长）：");
  for (const [r, xs] of Object.entries(summary)) {
    const s = [...xs].sort((a, b) => a - b);
    console.log(`  ${r.padEnd(24)} ${s[Math.floor(s.length / 2)]!.toFixed(0).padStart(6)}ms`);
  }
}

void main();
