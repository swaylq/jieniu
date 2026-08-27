// 机构痕迹采集（龙虎榜机构专用席位 / 龙虎榜北向专用席位 / 大宗交易机构专用）。
// 用法：NODE_ENV=development npx tsx src/scripts/ingest-institutional-trace.ts --days=3
//
// 幂等：按 (ticker, tradeDate, kind) upsert，重跑只刷新不重复。
// 默认回补最近 3 个自然日——龙虎榜与大宗都是盘后出，当天傍晚才有；
// 多刷两天是为了兜住「昨天那轮没跑成」的情况，成本极低（每天几百行）。

import { PrismaClient } from "../../generated/prisma";
import {
  fetchInstitutionalTraces,
  saveInstitutionalTraces,
} from "../server/ingest/institutional-trace";

const db = new PrismaClient();

function arg(name: string, dflt: number): number {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  const v = hit ? Number(hit.split("=")[1]) : NaN;
  return Number.isFinite(v) ? v : dflt;
}

/** 东八区日历日，往回推 n 天。不用 `toISOString()`——那会按 UTC 把 8/6 写成 8/5。 */
function cstDay(offset: number): string {
  const t = new Date(Date.now() + 8 * 3600_000 - offset * 86_400_000);
  return t.toISOString().slice(0, 10);
}

async function main() {
  const days = arg("days", 3);
  let fetched = 0;
  let saved = 0;
  let unmatched = 0;
  let failedSources = 0;
  const perDay: string[] = [];

  for (let i = 0; i < days; i++) {
    const day = cstDay(i);
    const r = await fetchInstitutionalTraces(day);
    const dead = Object.entries(r.sources).filter(([, ok]) => !ok);
    // 「三个源全挂」和「今天本来就没有痕迹」必须分开报——前者是故障，后者是常态
    // （周末、以及没有股票上榜的日子，本来就是 0 行）。
    if (dead.length > 0) {
      failedSources += dead.length;
      console.log(
        `[inst-trace] ${day} 源取不到：${dead.map(([k]) => k).join(",")}`,
      );
    }
    const s = await saveInstitutionalTraces(db, r.traces);
    fetched += s.fetched;
    saved += s.saved;
    unmatched += s.unmatched;
    perDay.push(`${day}:${s.saved}`);
  }

  console.log(
    `[inst-trace] ${perDay.join(" ")} · 抓到 ${fetched} 条 · 入库 ${saved} · 无对应实体 ${unmatched} · 源失败 ${failedSources}`,
  );
  console.log(
    "JSON_RESULT " +
      JSON.stringify({ fetched, saved, unmatched, failedSources, days }),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
