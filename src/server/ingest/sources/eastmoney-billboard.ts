import type { RawNewsItem, SourceDef } from "../types";

// 龙虎榜（东财数据中心 RPT_DAILYBILLBOARD_DETAILSNEW）——交易所收盘后披露的席位异动，
// **不是公司公告**（东财公告源没有它），纯增量。作为「结构化事件」走既有 runner：模板成
// RawNewsItem，subjectOnly 只按 entityHints(股票简称+代码) 精确挂载，不做标题文本匹配。
// 只保留覆盖池内个股（fetch 时按 dict 过滤），避免全市场龙虎榜刷屏。

const API = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export type BillboardRow = {
  SECURITY_CODE?: string;
  SECURITY_NAME_ABBR?: string;
  TRADE_DATE?: string; // "2026-07-23 00:00:00"（日期精度）
  EXPLANATION?: string; // 上榜原因
  BILLBOARD_NET_AMT?: number; // 龙虎榜净买额（元，负=净卖出）
};

/** 把一条龙虎榜明细模板成 RawNewsItem（纯函数，便于单测）。无代码/名字返回 null。 */
export function billboardToRawItem(row: BillboardRow): RawNewsItem | null {
  const code = (row.SECURITY_CODE ?? "").trim();
  const name = (row.SECURITY_NAME_ABBR ?? "").trim();
  if (code === "" || name === "") return null;
  const net = typeof row.BILLBOARD_NET_AMT === "number" ? row.BILLBOARD_NET_AMT : 0;
  const dir = net >= 0 ? "净买入" : "净卖出";
  const amtWan = Math.round(Math.abs(net) / 1e4);
  const reason = (row.EXPLANATION ?? "").trim();
  const title = `${name}登龙虎榜：${dir}${amtWan}万元${reason ? `（${reason}）` : ""}`;
  const date = (row.TRADE_DATE ?? "").slice(0, 10);
  // 龙虎榜收盘后披露 → 用交易日 18:00 CST 作发布时刻代理（避免落当日 00:00 沉到快讯底下）。
  const publishedAt = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T18:00:00+08:00`)
    : new Date();
  return {
    // 同股同日可能多条（不同上榜原因）——externalId 带 reason 区分，hash 去重兜底。
    externalId: `lhb-${code}-${date}-${reason}`.slice(0, 120),
    title,
    url: `https://data.eastmoney.com/stock/lhb/${code}.html`,
    summary: title,
    publishedAt,
    eventType: "龙虎榜",
    entityHints: [name, code],
  };
}

async function fetchLatestBillboard(): Promise<BillboardRow[]> {
  // 拉最近交易日的龙虎榜（按 TRADE_DATE 降序取一页；全市场，随后按覆盖池过滤）。
  const url =
    `${API}?reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=ALL` +
    `&pageNumber=1&pageSize=500&sortColumns=TRADE_DATE&sortTypes=-1`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://data.eastmoney.com/" },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`billboard ${res.status}`);
  const j = (await res.json()) as { result?: { data?: BillboardRow[] } };
  return j.result?.data ?? [];
}

/**
 * 东财·龙虎榜（覆盖池内个股的席位异动事件）。tier=PRIMARY（交易所法定披露的再分发）。
 * subjectOnly：主体由源权威给出（股票简称+代码），标题里的词不做文本匹配。
 */
export const eastmoneyBillboard: SourceDef = {
  key: "eastmoney-billboard",
  name: "东方财富·龙虎榜",
  tier: "PRIMARY",
  kind: "fund-flow",
  subjectOnly: true,
  async fetch(dict): Promise<RawNewsItem[]> {
    const covered = new Set(
      dict.flatMap((e) => (e.type === "STOCK" && e.ticker ? [e.ticker] : [])),
    );
    const rows = await fetchLatestBillboard();
    const out: RawNewsItem[] = [];
    for (const row of rows) {
      const code = (row.SECURITY_CODE ?? "").trim();
      if (!covered.has(code)) continue; // 只收覆盖池内个股
      const item = billboardToRawItem(row);
      if (item) out.push(item);
    }
    return out;
  },
};
