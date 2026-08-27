// 逐日行情+主力资金回填（机会雷达底座）。
// 用法：NODE_ENV=development npx tsx src/scripts/backfill-market-daily.ts --limit=800 --days=60 --concurrency=6
//
// **有界分片**：每片跑完即报「还缺多少」，被杀重跑即续（幂等）。
// 日常刷新用 --days=5 --minDays=999（强制所有股都刷最近几天）。

import { PrismaClient } from "../../generated/prisma";
import { backfillMarketDaily } from "../server/ingest/market-daily";

const db = new PrismaClient();

function arg(name: string, dflt: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  const v = hit ? Number(hit.split("=")[1]) : NaN;
  return Number.isFinite(v) ? v : dflt;
}

async function main() {
  const limit = arg("limit", 500);
  const days = arg("days", 60);
  const concurrency = arg("concurrency", 1);
  const paceMs = arg("pace", 400);
  const minDays = arg("minDays", Math.min(days, 40));
  const t0 = Date.now();

  const r = await backfillMarketDaily(db, {
    limit,
    days,
    concurrency,
    paceMs,
    minDays,
    onProgress: (done, total) =>
      console.log(
        `  … ${done}/${total} (${Math.round((Date.now() - t0) / 1000)}s)`,
      ),
  });

  const secs = Math.round((Date.now() - t0) / 1000);
  if (r.banned) {
    // 单独喊出来：被封时 failed 没有诊断意义（后面的股根本没打），
    // 而且继续跑只会延长封禁。运维动作是「等 5~60 分钟再跑」，不是「查接口变更」。
    console.log(
      `[market-daily] ⛔ 本机 IP 被新浪封禁，已中止本轮（成功 ${r.ok} 只后中断，剩 ${r.skipped} 只未跑）。` +
        `自解封需 5~60 分钟；请降并发/加节流后重试，别原地重跑。`,
    );
  }
  console.log(
    `[market-daily] 本片 ${r.ok}/${r.attempted} 成功 · 失败 ${r.failed} · 源无数据 ${r.empty} · 写入 ${r.rows} 行 · ${secs}s`,
  );
  console.log(`[market-daily] 仍缺（历史不足 ${minDays} 天的股）：${r.remaining}`);
  console.log(
    `JSON_RESULT ${JSON.stringify({
      ok: r.ok,
      failed: r.failed,
      empty: r.empty,
      // 判据盯 banned 而不是 failed：被封时 failed 反而小（后面根本没打），
      // 用 failed 当阈值会在最严重的那天沉默。
      banned: r.banned ? 1 : 0,
      skipped: r.skipped,
      rows: r.rows,
      remaining: r.remaining,
      secs,
    })}`,
  );
}

main()
  .catch((e) => {
    console.error("[market-daily] FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
