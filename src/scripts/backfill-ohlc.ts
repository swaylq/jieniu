// 前复权四价回填（一字板 / 连涨 / 除权断裂判定的底座）。
// 用法：NODE_ENV=development npx tsx src/scripts/backfill-ohlc.ts --limit=6000 --days=160 --concurrency=8
//
// 只给 MarketDaily 已有的行补 open/high/low/adjClose，不新建行——
// 交易日历以新浪资金流那条管线为准，避免两个源的日历打架。

import { PrismaClient } from "../../generated/prisma";
import { backfillOhlc } from "../server/ingest/market-ohlc";

const db = new PrismaClient();

function arg(name: string, dflt: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  const v = hit ? Number(hit.split("=")[1]) : NaN;
  return Number.isFinite(v) ? v : dflt;
}

async function main() {
  const t0 = Date.now();
  const r = await backfillOhlc(db, {
    limit: arg("limit", 500),
    days: arg("days", 160),
    concurrency: arg("concurrency", 8),
    minFilled: arg("minFilled", 100),
    onProgress: (d, t) =>
      console.log(`  … ${d}/${t} (${Math.round((Date.now() - t0) / 1000)}s)`),
  });
  const secs = Math.round((Date.now() - t0) / 1000);
  console.log(
    `[ohlc] 本片 ${r.ok}/${r.attempted} 成功 · 失败 ${r.failed} · 更新 ${r.rowsUpdated} 行 · ${secs}s`,
  );
  console.log(`[ohlc] 仍缺四价的股：${r.remaining}`);
  console.log(
    `JSON_RESULT ${JSON.stringify({ ok: r.ok, failed: r.failed, rows: r.rowsUpdated, remaining: r.remaining, secs })}`,
  );
}

main()
  .catch((e) => {
    console.error("[ohlc] FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
