import type { RawNewsItem, SourceDef } from "../types";

// 业绩预告（东财数据中心 RPT_PUBLIC_OP_NEWPREDICT）——公司法定披露的净利预告，
// 预增/预减/扭亏是硬 thesis 兑现/证伪事件。走既有 runner 结构化事件路径。
// 注：预告也发公告（已被东财公告抓入），但本源带 类型/增幅区间/原因 的结构化信息；接受轻度并存。
// 同股同报告期可能多条修正稿 → 按 (code, REPORT_DATE) 只保最新披露一条。

const API = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export type ForecastRow = {
  SECURITY_CODE?: string;
  SECURITY_NAME_ABBR?: string;
  PREDICT_TYPE?: string; // 预增/略增/扭亏/减亏/续亏/预减/略减/续盈
  ADD_AMP_LOWER?: number; // 净利同比增幅下限 %
  ADD_AMP_UPPER?: number; // 上限 %
  CHANGE_REASON_EXPLAIN?: string;
  NOTICE_DATE?: string;
  REPORT_DATE?: string;
};

/** 一条业绩预告 → RawNewsItem。无代码/名字/类型返回 null。纯函数，便于单测。 */
export function forecastToRawItem(row: ForecastRow): RawNewsItem | null {
  const code = (row.SECURITY_CODE ?? "").trim();
  const name = (row.SECURITY_NAME_ABBR ?? "").trim();
  const type = (row.PREDICT_TYPE ?? "").trim();
  if (code === "" || name === "" || type === "") return null;
  const lo = row.ADD_AMP_LOWER;
  const hi = row.ADD_AMP_UPPER;
  let amp = "";
  if (typeof lo === "number" && typeof hi === "number") {
    amp = `，净利同比${Number(lo.toFixed(0))}~${Number(hi.toFixed(0))}%`;
  } else if (typeof lo === "number") {
    amp = `，净利同比${Number(lo.toFixed(0))}%`;
  }
  const reason = (row.CHANGE_REASON_EXPLAIN ?? "").trim();
  const reasonStr = reason ? `（${reason.slice(0, 40)}）` : "";
  const rptQ = (row.REPORT_DATE ?? "").slice(0, 10);
  const title = `${name}业绩预告：${type}${amp}${reasonStr}`;
  const date = (row.NOTICE_DATE ?? "").slice(0, 10);
  const publishedAt = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T08:00:00+08:00`)
    : new Date();
  return {
    // 同股同报告期多条修正稿 → externalId 只带 (code, 报告期)，后到的同 key 命中 hash 去重。
    externalId: `forecast-${code}-${rptQ}`,
    title,
    url: `https://data.eastmoney.com/notices/detail/${code}.html`,
    summary: title,
    publishedAt,
    eventType: "业绩预告",
    entityHints: [name, code],
  };
}

async function fetchLatestForecasts(): Promise<ForecastRow[]> {
  const url =
    `${API}?reportName=RPT_PUBLIC_OP_NEWPREDICT&columns=ALL` +
    `&pageNumber=1&pageSize=500&sortColumns=NOTICE_DATE&sortTypes=-1`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://data.eastmoney.com/" },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`forecast ${res.status}`);
  const j = (await res.json()) as { result?: { data?: ForecastRow[] } };
  return j.result?.data ?? [];
}

/** 东财·业绩预告（覆盖池内个股）。tier=PRIMARY，subjectOnly。 */
export const eastmoneyForecast: SourceDef = {
  key: "eastmoney-forecast",
  name: "东方财富·业绩预告",
  tier: "PRIMARY",
  kind: "fund-flow",
  subjectOnly: true,
  async fetch(dict): Promise<RawNewsItem[]> {
    const covered = new Set(
      dict.flatMap((e) => (e.type === "STOCK" && e.ticker ? [e.ticker] : [])),
    );
    const rows = await fetchLatestForecasts();
    // 同股同报告期留最新披露（rows 已按 NOTICE_DATE 降序，先到的即最新）。
    const seen = new Set<string>();
    const out: RawNewsItem[] = [];
    for (const r of rows) {
      const code = (r.SECURITY_CODE ?? "").trim();
      if (!covered.has(code)) continue;
      const key = `${code}|${(r.REPORT_DATE ?? "").slice(0, 10)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const item = forecastToRawItem(r);
      if (item) out.push(item);
    }
    return out;
  },
};
