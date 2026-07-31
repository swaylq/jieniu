import type { PrismaClient } from "../../../generated/prisma";
import { parseSinaMoneyFlow, type DailyFlow } from "../../lib/radar/sina-flow";
import { tickerToSymbol } from "../../lib/quote";

/**
 * 逐日行情 + 主力资金采集 → `MarketDaily`（机会雷达的量化底座）。
 *
 * 相对导入（不用 `~` 别名）：让 `src/scripts/*.ts` 走 tsx 也能引用。
 *
 * 源选择的实测依据（2026-07-31，本节点）：
 *  · 东财 `push2` clist —— 连打 5 次**全部空响应**，正在封锁期；且它本身只给"今天这一格"，
 *    给不了 60 日历史，而雷达的判据全是时序的。
 *  · 新浪 `MoneyFlow.ssl_qsfx_zjlrqs` —— 一次请求回 60 个交易日，0.33s / 17KB。**主源**。
 *
 * 幂等：先 `createMany(skipDuplicates)` 灌历史，再对最近 `REFRESH_DAYS` 天逐行 upsert
 * （盘中数据当天会变，历史日收盘后不变）。被杀重跑即续，不丢进度。
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const API =
  "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/MoneyFlow.ssl_qsfx_zjlrqs";

/** 当天/昨天的行会变（盘中、以及新浪补数据），这几天走 upsert 而不是 skipDuplicates。 */
const REFRESH_DAYS = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 取一只股最近 `days` 个交易日的资金流。
 *
 * 返回 `null` = **取不到**（被限流/网络错/源返回错误对象），返回 `[]` = 源明确说没有数据。
 * 两者必须分开——混成一个会把"被限流"记成"这只股没历史"，静默留下永久空洞。
 */
export async function fetchStockDailyFlow(
  ticker: string,
  days = 60,
  backoffMs = 500,
  attempts = 3,
): Promise<DailyFlow[] | null> {
  const symbol = tickerToSymbol(ticker);
  if (!symbol) return null;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(
        `${API}?page=1&num=${days}&sort=opendate&asc=0&daima=${symbol}`,
        {
          headers: { "User-Agent": UA, Referer: "https://finance.sina.com.cn" },
          cache: "no-store",
          signal: AbortSignal.timeout(12000),
        },
      );
      if (res.ok) {
        const text = (await res.text()).trim();
        // 新浪限流时回空串、代码不存在时回 `{"__ERROR":3}`——都不是"没有历史"
        if (text.startsWith("[")) {
          const rows = parseSinaMoneyFlow(JSON.parse(text));
          if (rows.length > 0) return rows;
        }
      }
    } catch {
      // 交给下面的退避重试；用尽仍失败由调用方计入 failed
    }
    if (i < attempts - 1) await sleep(backoffMs * (i + 1));
  }
  return null;
}

function dateOf(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** 一只股的行落库。返回写入行数。 */
export async function saveDailyFlow(
  db: PrismaClient,
  entityId: string,
  ticker: string,
  rows: DailyFlow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const data = rows.map((r) => ({
    entityId,
    ticker,
    tradeDate: dateOf(r.day),
    close: r.close,
    changePct: r.changePct,
    amount: r.amount,
    netAmount: r.netAmount,
    netRatio: r.netRatio,
    turnoverRate: r.turnoverRate,
  }));
  await db.marketDaily.createMany({ data, skipDuplicates: true });

  // 最近几天可能是盘中快照，重跑要能刷新
  for (const d of data.slice(-REFRESH_DAYS)) {
    await db.marketDaily.update({
      where: { ticker_tradeDate: { ticker, tradeDate: d.tradeDate } },
      data: {
        close: d.close,
        changePct: d.changePct,
        amount: d.amount,
        netAmount: d.netAmount,
        netRatio: d.netRatio,
        turnoverRate: d.turnoverRate,
      },
    });
  }
  return data.length;
}

export type BackfillResult = {
  attempted: number;
  ok: number;
  failed: number;
  rows: number;
  remaining: number;
};

/**
 * 批量回填。**有界分片**（`limit`）+ 幂等：长回填就算单跑也会被系统回收，
 * 靠 cron 托管重跑续上（「长回填要靠有界分片 + cron 托管」那条教训）。
 *
 * `needDays` 少于这个数的股优先补——按缺口排序，不按总量排序，
 * 否则"总量够但这只缺"的股永远补不到。
 */
export async function backfillMarketDaily(
  db: PrismaClient,
  opts: {
    limit: number;
    days?: number;
    concurrency?: number;
    minDays?: number;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<BackfillResult> {
  const days = opts.days ?? 60;
  const concurrency = opts.concurrency ?? 6;
  const minDays = opts.minDays ?? Math.min(days, 40);

  // 按「已有天数」升序挑最缺的；一次 SQL 完成，不把 5500 只股拉进内存排序
  const targets = await db.$queryRawUnsafe<
    { id: string; ticker: string; have: bigint }[]
  >(
    `SELECT e.id, e.ticker, count(m.id) AS have
       FROM "Entity" e
       LEFT JOIN "MarketDaily" m ON m."entityId" = e.id
      WHERE e.type = 'STOCK' AND e.ticker IS NOT NULL
      GROUP BY e.id, e.ticker
     HAVING count(m.id) < $1
      ORDER BY count(m.id) ASC, e.ticker ASC
      LIMIT $2`,
    minDays,
    opts.limit,
  );
  const remainingRow = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM (
       SELECT e.id FROM "Entity" e
       LEFT JOIN "MarketDaily" m ON m."entityId" = e.id
       WHERE e.type = 'STOCK' AND e.ticker IS NOT NULL
       GROUP BY e.id HAVING count(m.id) < $1) t`,
    minDays,
  );

  let ok = 0;
  let failed = 0;
  let rows = 0;
  let done = 0;
  const queue = [...targets];

  async function worker() {
    for (;;) {
      const t = queue.shift();
      if (!t) return;
      const flows = await fetchStockDailyFlow(t.ticker, days);
      if (flows === null) failed++;
      else {
        rows += await saveDailyFlow(db, t.id, t.ticker, flows);
        ok++;
      }
      done++;
      if (done % 50 === 0) opts.onProgress?.(done, targets.length);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, worker),
  );

  return {
    attempted: targets.length,
    ok,
    failed,
    rows,
    // 报「还缺多少」而不是「跑了多少」——被杀的进程没有 exit code 可看，
    // 判完成只能看业务量
    remaining: Math.max(0, Number(remainingRow[0]?.n ?? 0n) - ok),
  };
}
