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
 * 新浪的封禁页。**HTTP 456 + 一段中文 HTML**，不是 429、也不是空响应。
 *
 * 2026-08-27 实测原文：「你的 IP 存在异常访问(例如: 爬虫/攻击/探测 等), 已被新浪安全部门封禁。
 * 停止异常访问一段时间后(5~60分钟)会自动解封」。
 *
 * 这条必须单独识别，理由是它把整轮的语义改了：被封之后**后面每一只都会失败**，
 * 继续打 5000 次不但白跑 19 分钟，还会把封禁时间续上。所以识别到就整轮中止。
 */
const BAN_STATUS = 456;
export function looksBanned(status: number, body: string): boolean {
  return status === BAN_STATUS || /拒绝访问|安全部门封禁/.test(body.slice(0, 400));
}

export type FlowFetch =
  | { kind: "ok"; rows: DailyFlow[] }
  /** 源明确说这只股没有数据（退市/美股代码/新股未满一天） */
  | { kind: "empty" }
  /** 取不到：超时、网络错、非 200——重试用尽仍失败 */
  | { kind: "miss" }
  /** 本机 IP 被源封禁，整轮该停 */
  | { kind: "banned" };

/**
 * 取一只股最近 `days` 个交易日的资金流。
 *
 * 三种失败必须分开，混成一个 null 就没法排查（2026-08-24~27 那次就是这么静默了四天）：
 *  · `empty`  = 源说没有这只股的数据 → 正常，别当故障
 *  · `miss`   = 单次取不到 → 计入失败数，下轮再补
 *  · `banned` = IP 被封 → **整轮立刻停**，继续打只会延长封禁
 */
export async function fetchStockDailyFlowResult(
  ticker: string,
  days = 60,
  backoffMs = 500,
  attempts = 3,
): Promise<FlowFetch> {
  const symbol = tickerToSymbol(ticker);
  if (!symbol) return { kind: "empty" };
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
      const text = (await res.text()).trim();
      if (looksBanned(res.status, text)) return { kind: "banned" };
      if (res.ok) {
        // 代码不存在时回 `{"__ERROR":3}`——**重试没用**，这只股新浪本来就没有数据
        // （143 只零行的退市壳/美股代码全落在这里）。判成 empty 而不是 miss，
        // 它们才不会年复一年地把失败数顶到告警线上。
        if (text.includes("__ERROR")) return { kind: "empty" };
        if (text.startsWith("[")) {
          const rows = parseSinaMoneyFlow(JSON.parse(text) as unknown);
          if (rows.length > 0) return { kind: "ok", rows };
          return { kind: "empty" };
        }
        // 限流时回空串——这个要重试
      }
    } catch {
      // 交给下面的退避重试；用尽仍失败由调用方计入 failed
    }
    if (i < attempts - 1) await sleep(backoffMs * (i + 1));
  }
  return { kind: "miss" };
}

/**
 * 兼容旧签名：拿不到一律 null。新代码请用 `fetchStockDailyFlowResult`——
 * 它能区分「被封」和「这只股没数据」，而这两件事的处理方式完全相反。
 */
export async function fetchStockDailyFlow(
  ticker: string,
  days = 60,
  backoffMs = 500,
  attempts = 3,
): Promise<DailyFlow[] | null> {
  const r = await fetchStockDailyFlowResult(ticker, days, backoffMs, attempts);
  return r.kind === "ok" ? r.rows : null;
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
    // 超大单净额：新浪响应里一直有 `r0_net`，2026-08-27 前解析器丢弃了它。
    // 存量行是 null，靠 backfill 补——判据一律容忍缺失，不拿 0 冒充。
    netAmountXl: r.netAmountXl,
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
        netAmountXl: d.netAmountXl,
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
  /** 源明确说「这只股没有数据」的只数（退市/美股代码），**不是故障**，别计入 failed 的告警。 */
  empty: number;
  /** 本机 IP 被新浪封禁而中止。true 时 `failed` 没有诊断意义——后面的股根本没打。 */
  banned: boolean;
  /** 因为封禁中止而没轮到的只数。 */
  skipped: number;
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
    /** 每个 worker 两次请求之间的间隔（毫秒）。默认 120——见并发那条注释。 */
    paceMs?: number;
    minDays?: number;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<BackfillResult> {
  const days = opts.days ?? 60;
  // 并发默认从 6 降到 3，并加逐请求节流：2026-08-27 实测，全市场 5501 只以并发 8
  // 无节流打新浪，会触发**按 IP 封禁**（HTTP 456 +「已被新浪安全部门封禁」页，
  // 自解封 5~60 分钟）。8-24 起生产上天天 failed=5500 就是这么来的，连续四天没人看出来。
  // 2026-08-27 实测：并发 3 + 120ms 节流（约 15 次/秒）跑到第 ~300 只仍被封。
  // 而 8-22/8-23 那两轮 5353 只 / 89s（约 55 次/秒）是通的——**新浪在 8-24 前后收紧了阈值**，
  // 具体门槛试不出来（每试错一次就是 5~60 分钟封禁）。
  // 所以不再靠猜参数：默认压到 1 并发 + 400ms（约 2.5 次/秒），并让调度侧用
  // 「小分片 + 半小时一轮」接力——撞封就干净停下，下一轮从最旧的那批续上。
  const concurrency = opts.concurrency ?? 1;
  const paceMs = opts.paceMs ?? 400;
  const minDays = opts.minDays ?? Math.min(days, 40);

  // 排序口径：**最新一根日线最旧的排最前**，其次才是总天数最少的。
  //
  // 为什么不是原来的「按已有天数升序」：日常刷新跑的是 `minDays=99999`（全市场都过一遍），
  // 于是每轮都从同一批总天数最少的股开始——而那批恰好是 143 只零行的退市壳
  // （000003 PT金田A、000015 PT中浩A、000024 招商地产…，新浪本来就没有它们的数据）。
  // 一旦某轮中途被封禁中止，下一轮又从这批尸体重新开始，**永远推进不到活股**。
  // 改成按 `max(tradeDate)` 升序后，昨天没补到的股天然排在前面，多轮之间能接力。
  // NULLS FIRST 保留：真的一行都没有的新股仍要优先补。
  const targets = await db.$queryRawUnsafe<
    { id: string; ticker: string; have: bigint }[]
  >(
    `SELECT e.id, e.ticker, count(m.id) AS have
       FROM "Entity" e
       LEFT JOIN "MarketDaily" m ON m."entityId" = e.id
      WHERE e.type = 'STOCK' AND e.ticker IS NOT NULL
      GROUP BY e.id, e.ticker
     HAVING count(m.id) < $1
      ORDER BY max(m."tradeDate") ASC NULLS FIRST, count(m.id) ASC, e.ticker ASC
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
  let empty = 0;
  let rows = 0;
  let done = 0;
  let banned = false;
  const queue = [...targets];

  async function worker() {
    for (;;) {
      // 被封之后每一只都会失败，继续打只是白跑十几分钟、还会把封禁时间续上。
      if (banned) return;
      const t = queue.shift();
      if (!t) return;
      const r = await fetchStockDailyFlowResult(t.ticker, days);
      if (r.kind === "banned") {
        banned = true;
        return;
      }
      if (r.kind === "ok") {
        rows += await saveDailyFlow(db, t.id, t.ticker, r.rows);
        ok++;
      } else if (r.kind === "empty") empty++;
      else failed++;
      done++;
      if (done % 50 === 0) opts.onProgress?.(done, targets.length);
      if (paceMs > 0) await sleep(paceMs);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, worker),
  );

  return {
    attempted: targets.length,
    ok,
    failed,
    empty,
    banned,
    skipped: banned ? targets.length - done : 0,
    rows,
    // 报「还缺多少」而不是「跑了多少」——被杀的进程没有 exit code 可看，
    // 判完成只能看业务量
    remaining: Math.max(0, Number(remainingRow[0]?.n ?? 0n) - ok),
  };
}
