import type { PrismaClient } from "../../../generated/prisma";
import {
  aggregateBlockTrades,
  aggregateHsgtSeats,
  aggregateOrgRows,
  type BlockRow,
  type OrgRow,
  type SeatRow,
  type Trace,
} from "../../lib/institutional-trace";

/**
 * 机构痕迹采集 → `InstitutionalTrace`。
 *
 * 三个源都在东财 datacenter 那个统一入口（`datacenter-web` 对本节点可达，
 * 而 `push2*` 系列是间歇封锁的——这是 2026-07-24 摸源就记下的分工）：
 *
 *  · `RPT_ORGANIZATION_TRADE_DETAILS` 龙虎榜机构专用席位（净买入 + 买卖席位数）
 *  · `RPT_BILLBOARD_DAILYDETAILSBUY/SELL` 龙虎榜席位明细 → 从中挑北向专用席位
 *  · `RPT_DATA_BLOCKTRADE` 大宗交易 → 买卖任一方是机构专用的部分
 *
 * **为什么北向要从席位明细里捞**：2024-08-19 起沪深股通个股持股改成季度披露，
 * 盘后连全市场北向净买入合计都不再公布。但龙虎榜上的「沪股通专用/深股通专用」席位
 * **照常公布买入额与卖出额**——这是目前唯一还剩的、有方向的个股级北向日频痕迹，
 * 覆盖面就是当天上榜的那几十只。零额外成本（跟机构席位同一张表），所以顺手一起收。
 *
 * 全部是 T+1 之后才稳定的盘后数据；采集时点见 `scheduler/jobs.ts`。
 */

const API = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** 单页上限。三个源单日量都是几百行，一页足够；仍留分页以防某天异常放量。 */
const PAGE_SIZE = 500;
const MAX_PAGES = 6;

async function fetchReport<T>(
  reportName: string,
  columns: string,
  filter: string,
  sortColumns = "TRADE_DATE",
): Promise<T[] | null> {
  const out: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const qs = new URLSearchParams({
      reportName,
      columns,
      pageNumber: String(page),
      pageSize: String(PAGE_SIZE),
      sortColumns,
      sortTypes: "-1",
      filter,
    });
    let json: unknown;
    try {
      const res = await fetch(`${API}?${qs}`, {
        headers: { "User-Agent": UA, Referer: "https://data.eastmoney.com/" },
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) return out.length > 0 ? out : null;
      json = await res.json();
    } catch {
      // 首页就失败 = 整轮没数据，和「取到但为空」必须分开报（否则静默故障）
      return out.length > 0 ? out : null;
    }
    const j = json as { result?: { data?: T[] } | null; success?: boolean };
    const data = j.result?.data;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return out;
}

export type TraceFetch = {
  traces: Trace[];
  /** 每个源是否**取到了**（null = 请求失败，与「取到 0 行」不是一回事）。 */
  sources: { org: boolean; hsgt: boolean; block: boolean };
};

/** 抓一个交易日的全部机构痕迹。`day` 形如 `2026-08-27`。 */
export async function fetchInstitutionalTraces(day: string): Promise<TraceFetch> {
  const f = `(TRADE_DATE='${day}')`;
  const [org, buy, sell, block] = await Promise.all([
    fetchReport<OrgRow>(
      "RPT_ORGANIZATION_TRADE_DETAILS",
      "SECURITY_CODE,TRADE_DATE,BUY_TIMES,SELL_TIMES,BUY_AMT,SELL_AMT,NET_BUY_AMT",
      f,
    ),
    fetchReport<SeatRow>(
      "RPT_BILLBOARD_DAILYDETAILSBUY",
      "SECURITY_CODE,TRADE_DATE,OPERATEDEPT_NAME,BUY,SELL",
      f,
    ),
    fetchReport<SeatRow>(
      "RPT_BILLBOARD_DAILYDETAILSSELL",
      "SECURITY_CODE,TRADE_DATE,OPERATEDEPT_NAME,BUY,SELL",
      f,
    ),
    fetchReport<BlockRow>(
      "RPT_DATA_BLOCKTRADE",
      "SECURITY_CODE,TRADE_DATE,DEAL_PRICE,CLOSE_PRICE,PREMIUM_RATIO,DEAL_AMT,BUYER_NAME,SELLER_NAME",
      f,
    ),
  ]);

  const traces: Trace[] = [];
  if (org) traces.push(...aggregateOrgRows(org));
  // 买卖两张表合起来算北向净额：只看买方表会把「北向在卖」整个漏掉。
  if (buy || sell) traces.push(...aggregateHsgtSeats([...(buy ?? []), ...(sell ?? [])]));
  if (block) traces.push(...aggregateBlockTrades(block));

  return {
    traces,
    sources: {
      org: org !== null,
      hsgt: buy !== null || sell !== null,
      block: block !== null,
    },
  };
}

export type TraceSaveResult = {
  fetched: number;
  saved: number;
  /** 有痕迹但库里没这只股的实体（多为 B 股/退市代码），只计数不当错误。 */
  unmatched: number;
};

/** 落库（按 (ticker, tradeDate, kind) upsert，幂等，重跑即刷新）。 */
export async function saveInstitutionalTraces(
  db: PrismaClient,
  traces: Trace[],
): Promise<TraceSaveResult> {
  if (traces.length === 0) return { fetched: 0, saved: 0, unmatched: 0 };
  const codes = [...new Set(traces.map((t) => t.ticker))];
  const stocks = await db.entity.findMany({
    where: { type: "STOCK", ticker: { in: codes } },
    select: { id: true, ticker: true },
  });
  const idByCode = new Map(stocks.map((s) => [s.ticker!, s.id]));

  let saved = 0;
  let unmatched = 0;
  for (const t of traces) {
    const entityId = idByCode.get(t.ticker);
    if (!entityId) {
      unmatched++;
      continue;
    }
    const tradeDate = new Date(`${t.tradeDate}T00:00:00.000Z`);
    const data = {
      entityId,
      ticker: t.ticker,
      tradeDate,
      kind: t.kind,
      netAmount: t.netAmount,
      buyAmount: t.buyAmount,
      sellAmount: t.sellAmount,
      detail: t.detail as object,
    };
    await db.institutionalTrace.upsert({
      where: {
        ticker_tradeDate_kind: { ticker: t.ticker, tradeDate, kind: t.kind },
      },
      create: data,
      update: data,
    });
    saved++;
  }
  return { fetched: traces.length, saved, unmatched };
}
