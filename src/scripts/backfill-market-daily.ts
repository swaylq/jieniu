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
  const concurrency = arg("concurrency", 6);
  const minDays = arg("minDays", Math.min(days, 40));
  const t0 = Date.now();

  const r = await backfillMarketDaily(db, {
    limit,
    days,
    concurrency,
    minDays,
    onProgress: (done, total) =>
      console.log(
        `  … ${done}/${total} (${Math.round((Date.now() - t0) / 1000)}s)`,
      ),
  });

  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(
    `[market-daily] 本片 ${r.ok}/${r.attempted} 成功 · 失败 ${r.failed} · 写入 ${r.rows} 行 · ${secs}s`,
  );
  console.log(`[market-daily] 仍缺（历史不足 ${minDays} 天的股）：${r.remaining}`);
  console.log(
    `JSON_RESULT ${JSON.stringify({ ok: r.ok, failed: r.failed, rows: r.rows, remaining: r.remaining, secs })}`,
  );
}

main()
  .catch((e) => {
    console.error("[market-daily] FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
