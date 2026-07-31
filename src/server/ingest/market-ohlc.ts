import type { PrismaClient } from "../../../generated/prisma";
import { parseTencentQfq, type QfqBar } from "../../lib/radar/qfq";
import { tickerToSymbol } from "../../lib/quote";

/**
 * 前复权四价回填 → `MarketDaily.open/high/low/adjClose`。
 *
 * 源是腾讯 `fqkline`（2026-07-31 实测一次可取 320 根、已前复权、带四价）。
 * 与 `market-daily.ts` 同形：有界分片 + 幂等 + 按缺口排序，被杀重跑即续。
 *
 * **只补已存在的行**，不新建行：日历与主键由 `market-daily.ts`（新浪资金流）确立，
 * 这里只是给它们补四价。两边对不上的日期直接跳过——宁可少补，
 * 不要凭腾讯的日历往库里插新浪没有的交易日。
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 取一只股的前复权日线。返回 `null` = 取不到（与「没有数据」分开）。 */
export async function fetchQfqBars(
  ticker: string,
  days = 160,
  backoffMs = 400,
  attempts = 3,
): Promise<QfqBar[] | null> {
  const symbol = tickerToSymbol(ticker);
  if (!symbol) return null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(
        `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,${days},qfq`,
        {
          headers: { "User-Agent": UA, Referer: "https://gu.qq.com" },
          cache: "no-store",
          signal: AbortSignal.timeout(12000),
        },
      );
      if (res.ok) {
        const bars = parseTencentQfq(await res.json(), symbol);
        if (bars.length > 0) return bars;
      }
    } catch {
      // 交给退避重试；用尽仍失败由调用方计入 failed
    }
    if (i < attempts - 1) await sleep(backoffMs * (i + 1));
  }
  return null;
}

export type OhlcResult = {
  attempted: number;
  ok: number;
  failed: number;
  rowsUpdated: number;
  remaining: number;
};

/**
 * 批量回填。`minFilled` 是「已经补了几天四价」的下限——低于它的股才会被挑中，
 * 所以重跑只补缺口，不会把全市场重刷一遍。
 */
export async function backfillOhlc(
  db: PrismaClient,
  opts: {
    limit: number;
    days?: number;
    concurrency?: number;
    minFilled?: number;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<OhlcResult> {
  const days = opts.days ?? 160;
  const concurrency = opts.concurrency ?? 8;
  const minFilled = opts.minFilled ?? 100;

  const targets = await db.$queryRawUnsafe<{ ticker: string; filled: bigint }[]>(
    `SELECT ticker, count(*) FILTER (WHERE "adjClose" IS NOT NULL) filled
       FROM "MarketDaily"
      GROUP BY ticker
     HAVING count(*) FILTER (WHERE "adjClose" IS NOT NULL) < $1
      ORDER BY count(*) FILTER (WHERE "adjClose" IS NOT NULL) ASC, ticker ASC
      LIMIT $2`,
    minFilled,
    opts.limit,
  );
  const remainRow = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) n FROM (
       SELECT ticker FROM "MarketDaily" GROUP BY ticker
       HAVING count(*) FILTER (WHERE "adjClose" IS NOT NULL) < $1) t`,
    minFilled,
  );

  let ok = 0;
  let failed = 0;
  let rowsUpdated = 0;
  let done = 0;
  const queue = [...targets];

  async function worker() {
    for (;;) {
      const t = queue.shift();
      if (!t) return;
      const bars = await fetchQfqBars(t.ticker, days);
      if (bars === null) failed++;
      else {
        // 一条 UPDATE ... FROM (VALUES ...) 把这只股所有日期一次写完，
        // 逐行 update 会是 5300 × 140 次往返
        const values = bars
          .map(
            (b) =>
              `('${b.day}'::date,${b.open},${b.high},${b.low},${b.close})`,
          )
          .join(",");
        const n = await db.$executeRawUnsafe(
          `UPDATE "MarketDaily" m
              SET open = v.o, high = v.h, low = v.l, "adjClose" = v.c
             FROM (VALUES ${values}) AS v(d, o, h, l, c)
            WHERE m.ticker = $1 AND m."tradeDate" = v.d`,
          t.ticker,
        );
        rowsUpdated += n;
        ok++;
      }
      done++;
      if (done % 100 === 0) opts.onProgress?.(done, targets.length);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, worker),
  );

  return {
    attempted: targets.length,
    ok,
    failed,
    rowsUpdated,
    remaining: Math.max(0, Number(remainRow[0]?.n ?? 0n) - ok),
  };
}
