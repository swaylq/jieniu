import type { RawNewsItem, SourceDef } from "../types";

// 大宗交易（东财数据中心 RPT_DATA_BLOCKTRADE）——交易所收盘后披露，**不是公司公告**，纯增量。
// 折价成交常是减持/套现信号。一只股一天可能几十笔 → **按股+日聚合成一条事件**防刷屏。
// 走既有 runner 的结构化事件路径（subjectOnly + entityHints 精确挂载）。

const API = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export type BlockTradeRow = {
  SECURITY_CODE?: string;
  SECURITY_NAME_ABBR?: string;
  TRADE_DATE?: string;
  DEAL_AMT?: number; // 成交金额（元）
  PREMIUM_RATIO?: number; // 折溢价率（%，负=折价）
};

/** 按 (股票, 交易日) 聚合大宗交易 → 一条事件（金额加权折溢价）。纯函数，便于单测。 */
export function aggregateBlockTrades(rows: BlockTradeRow[]): RawNewsItem[] {
  type Group = {
    code: string;
    name: string;
    date: string;
    count: number;
    totalAmt: number;
    premAcc: number; // Σ(prem × amt)，用于金额加权
  };
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const code = (r.SECURITY_CODE ?? "").trim();
    const name = (r.SECURITY_NAME_ABBR ?? "").trim();
    const date = (r.TRADE_DATE ?? "").slice(0, 10);
    if (code === "" || name === "" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const amt = typeof r.DEAL_AMT === "number" ? r.DEAL_AMT : 0;
    const prem = typeof r.PREMIUM_RATIO === "number" ? r.PREMIUM_RATIO : 0;
    const key = `${code}|${date}`;
    const g = groups.get(key) ?? {
      code,
      name,
      date,
      count: 0,
      totalAmt: 0,
      premAcc: 0,
    };
    g.count += 1;
    g.totalAmt += amt;
    g.premAcc += prem * amt;
    groups.set(key, g);
  }
  const out: RawNewsItem[] = [];
  for (const g of groups.values()) {
    const prem = g.totalAmt > 0 ? g.premAcc / g.totalAmt : 0;
    const dir = prem < 0 ? "折价" : "溢价";
    const premStr = Number(Math.abs(prem).toFixed(1));
    const wan = Math.round(g.totalAmt / 1e4);
    const title = `${g.name}大宗交易：${g.count}笔共${wan}万元，均${dir}${premStr}%`;
    out.push({
      externalId: `blk-${g.code}-${g.date}`,
      title,
      url: `https://data.eastmoney.com/dzjy/detail/${g.code}.html`,
      summary: title,
      publishedAt: new Date(`${g.date}T18:00:00+08:00`),
      eventType: "大宗交易",
      entityHints: [g.name, g.code],
    });
  }
  return out;
}

async function fetchLatestBlockTrades(): Promise<BlockTradeRow[]> {
  const url =
    `${API}?reportName=RPT_DATA_BLOCKTRADE&columns=ALL` +
    `&pageNumber=1&pageSize=1000&sortColumns=TRADE_DATE&sortTypes=-1`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://data.eastmoney.com/" },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`blocktrade ${res.status}`);
  const j = (await res.json()) as { result?: { data?: BlockTradeRow[] } };
  return j.result?.data ?? [];
}

/** 东财·大宗交易（覆盖池内个股，按股+日聚合）。tier=PRIMARY，subjectOnly。 */
export const eastmoneyBlockTrade: SourceDef = {
  key: "eastmoney-blocktrade",
  name: "东方财富·大宗交易",
  tier: "PRIMARY",
  kind: "fund-flow",
  subjectOnly: true,
  async fetch(dict): Promise<RawNewsItem[]> {
    const covered = new Set(
      dict.flatMap((e) => (e.type === "STOCK" && e.ticker ? [e.ticker] : [])),
    );
    const rows = (await fetchLatestBlockTrades()).filter((r) =>
      covered.has((r.SECURITY_CODE ?? "").trim()),
    );
    return aggregateBlockTrades(rows);
  },
};
