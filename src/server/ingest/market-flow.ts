import type { PrismaClient } from "../../../generated/prisma";
import { parseFlowRows, type StockFlow } from "../../lib/rotation";

/**
 * 全市场 A 股「涨跌幅 + 主力净流入」采集 → `EntitySignal(kind="flow")`。
 *
 * 为什么必须落库、不能渲染时现拉：
 *  ① 东财 `push2` 对本节点是**间歇封锁**——实测同一端点连打 3 次会失败 1~2 次。
 *     渲染时现拉等于把页面可用性押在一个随机失败的第三方上。
 *  ② 全市场 5800+ 只股、每页硬顶 100 条 → 要 59 次请求。这是后台作业的活，不是请求路径的活。
 *
 * 落库复用 `EntitySignal`（每股每 kind 一行 upsert），**零 schema 迁移**。
 * 相对导入（不用 `~` 别名）：让 `src/scripts/*.ts` 走 tsx 也能引用。
 */

const API = "https://push2.eastmoney.com/api/qt/clist/get";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
// 深主板 / 创业板 / 沪主板 / 科创板 / 北交所
const FS = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048";
const FIELDS = "f12,f14,f2,f3,f62,f184";
/** 东财硬顶：pz 给多大都只返回 100 条。 */
export const PAGE_SIZE = 100;
/** 页数上限：全市场 ~5900 只 → 59 页，留足余量做保险丝。 */
const MAX_PAGES = 80;
/** 重试退避基数。可注入——测试里压到 1ms，否则单页重试就要 4.8s、必超时。 */
const backoffMs = 800;

export type FlowDetail = {
  changePct: number;
  netInflow: number;
  inflowRatio: number;
  price: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 取一页，失败重试。东财间歇封锁时返回**空响应体**（不是 HTTP 错误码），
 * 所以「拿到 200」不能当成功——必须看解析出的行数（curl 200 骗局的同族）。
 * 一并回传 `total`，让调用方按总数算该翻多少页。
 */
async function fetchPage(
  page: number,
  backoff = backoffMs,
  attempts = 4,
): Promise<{ rows: StockFlow[]; total: number; rawCount: number } | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const url =
        `${API}?pn=${page}&pz=${PAGE_SIZE}&po=1&np=1&fltt=2&invt=2&fid=f3` +
        `&fs=${encodeURIComponent(FS)}&fields=${FIELDS}&ut=b2884a393a59ad64002292a3e90d46a5`;
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Referer: "https://quote.eastmoney.com" },
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const text = await res.text();
        if (text.trim().startsWith("{")) {
          const json = JSON.parse(text) as {
            data?: { total?: number; diff?: unknown[] };
          };
          const rows = parseFlowRows(json);
          if (rows.length > 0) {
            // rawCount 是**过滤前**的条数：页内混着停牌股（字段 "-"）会被 parseFlowRows
            // 丢掉，拿过滤后的条数判断「是否最后一页」会提前收工。
            return {
              rows,
              total: json.data?.total ?? 0,
              rawCount: Array.isArray(json.data?.diff) ? json.data.diff.length : rows.length,
            };
          }
        }
      }
    } catch {
      // 交给下面的退避重试；最后仍失败时由调用方计入 failedPages
    }
    if (i < attempts - 1) await sleep(backoff * (i + 1));
  }
  return null;
}

/**
 * 翻完全市场。
 *
 * **被封的空页 ≠ 翻到底**——这是实跑才暴露的坑：最初把「连续空页」当结束直接 break，
 * 5884 只股只采到 1100 只，而 `fetched` 看着还像成功，板块统计会静默地只覆盖三分之一。
 * 现在改成：用第一页回传的 `total` 算出应翻页数，中间某页失败**只计数、不中断**，
 * 只有「某页返回不满一页」才是真正的结束信号。
 */
export async function fetchAllFlows(
  backoff = backoffMs,
): Promise<{ rows: StockFlow[]; total: number; failedPages: number }> {
  const first = await fetchPage(1, backoff);
  if (!first) return { rows: [], total: 0, failedPages: 1 };

  const total = first.total;
  const rows: StockFlow[] = [...first.rows];
  let failedPages = 0;
  if (first.rawCount < PAGE_SIZE || total <= PAGE_SIZE)
    return { rows, total, failedPages };

  const pages = Math.min(MAX_PAGES, Math.ceil(total / PAGE_SIZE));
  for (let page = 2; page <= pages; page++) {
    const r = await fetchPage(page, backoff);
    if (!r) {
      failedPages++; // 被封就跳过这一页，继续翻——不能当成翻到底
      continue;
    }
    rows.push(...r.rows);
    if (r.rawCount < PAGE_SIZE) break; // 真正的结束信号（比原始条数，不比过滤后）
    await sleep(Math.min(120, backoff)); // 别把东财打急了
  }
  return { rows, total, failedPages };
}

/**
 * 扫全市场，写进覆盖池内个股的 `EntitySignal(kind="flow")`。
 * 返回抓到/写入/失败页数——**失败页数必须报出来**，否则「板块只统计到一半」会静默发生。
 */
export async function populateMarketFlow(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<{ fetched: number; total: number; upserted: number; failedPages: number }> {
  const stocks = await db.entity.findMany({
    where: { type: "STOCK", ticker: { not: null } },
    select: { id: true, ticker: true },
  });
  const idByCode = new Map(stocks.map((s) => [s.ticker!, s.id]));

  const { rows: all, total, failedPages } = await fetchAllFlows();
  if (failedPages > 0)
    console.error(
      `[market-flow] ${failedPages} 页取不到（东财间歇封锁）——本轮覆盖 ${all.length}/${total}`,
    );

  let upserted = 0;
  for (const s of all) {
    const entityId = idByCode.get(s.code);
    if (!entityId) continue;
    const detail: FlowDetail = {
      changePct: s.changePct,
      netInflow: s.netInflow,
      inflowRatio: s.inflowRatio,
      price: s.price,
    };
    const dir = s.netInflow >= 0 ? "净流入" : "净流出";
    await db.entitySignal.upsert({
      where: { entityId_kind: { entityId, kind: "flow" } },
      create: {
        entityId,
        kind: "flow",
        label: `主力${dir} ${(Math.abs(s.netInflow) / 1e8).toFixed(2)} 亿`,
        numValue: s.netInflow,
        detail,
        asOf: now,
      },
      update: {
        label: `主力${dir} ${(Math.abs(s.netInflow) / 1e8).toFixed(2)} 亿`,
        numValue: s.netInflow,
        detail,
        asOf: now,
      },
    });
    upserted++;
  }

  return { fetched: all.length, total, upserted, failedPages };
}
