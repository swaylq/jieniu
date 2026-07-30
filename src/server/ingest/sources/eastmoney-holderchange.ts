import type { RawNewsItem, SourceDef } from "../types";

// 董监高增减持（东财数据中心 RPT_EXECUTIVE_HOLD_DETAILS）——内部人真金白银的买卖，最强
// thesis 确认/证伪信号之一。走既有 runner 结构化事件路径（subjectOnly + entityHints）。
// 注：增减持也会发公告（已被东财公告源抓入），但本源带 人/职位/股数/均价 的结构化信息，
// 信息密度更高；标题措辞不同 → 跨源整标题判重不会误并，接受轻度并存。

const API = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export type ExecHoldRow = {
  SECURITY_CODE?: string;
  SECURITY_NAME_ABBR?: string; // 数据中心该报表用 SECURITY_NAME，容错兼容
  SECURITY_NAME?: string;
  PERSON_NAME?: string;
  POSITION_NAME?: string;
  CHANGE_SHARES?: number; // ± 股数
  AVERAGE_PRICE?: number;
  CHANGE_DATE?: string;
};

function fmtShares(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e8) return `${Number((abs / 1e8).toFixed(2))}亿股`;
  if (abs >= 1e4) return `${Number((abs / 1e4).toFixed(1))}万股`;
  return `${abs}股`;
}

/** 一条董监高增减持 → RawNewsItem。无代码/名字/人名返回 null。纯函数，便于单测。 */
export function holderChangeToRawItem(row: ExecHoldRow): RawNewsItem | null {
  const code = (row.SECURITY_CODE ?? "").trim();
  const name = (row.SECURITY_NAME_ABBR ?? row.SECURITY_NAME ?? "").trim();
  const person = (row.PERSON_NAME ?? "").trim();
  if (code === "" || name === "" || person === "") return null;
  const shares = typeof row.CHANGE_SHARES === "number" ? row.CHANGE_SHARES : 0;
  if (shares === 0) return null;
  const dir = shares > 0 ? "增持" : "减持";
  const pos = (row.POSITION_NAME ?? "").trim();
  const price =
    typeof row.AVERAGE_PRICE === "number" && row.AVERAGE_PRICE > 0
      ? `，均价${row.AVERAGE_PRICE}`
      : "";
  const title = `${name} ${pos}${person}${dir}${fmtShares(shares)}${price}`;
  const date = (row.CHANGE_DATE ?? "").slice(0, 10);
  const publishedAt = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T18:00:00+08:00`)
    : new Date();
  return {
    externalId: `exhold-${code}-${date}-${person}-${shares}`.slice(0, 120),
    title,
    url: `https://data.eastmoney.com/executive/${code}.html`,
    summary: title,
    publishedAt,
    eventType: dir,
    entityHints: [name, code],
  };
}

async function fetchLatestExecHold(): Promise<ExecHoldRow[]> {
  const url =
    `${API}?reportName=RPT_EXECUTIVE_HOLD_DETAILS&columns=ALL` +
    `&pageNumber=1&pageSize=500&sortColumns=CHANGE_DATE&sortTypes=-1`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://data.eastmoney.com/" },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`exec-hold ${res.status}`);
  const j = (await res.json()) as { result?: { data?: ExecHoldRow[] } };
  return j.result?.data ?? [];
}

// ── 股东增减持（RPT_SHARE_HOLDER_INCREASE，大股东层面，与董监高互补）─────────────

export type ShareholderRow = {
  SECURITY_CODE?: string;
  SECURITY_NAME_ABBR?: string;
  HOLDER_NAME?: string;
  DIRECTION?: string; // "增持" / "减持"
  CHANGE_RATE?: number; // 变动占总股本比例 %
  HOLD_RATIO?: number; // 变动后持股比例 %
  NOTICE_DATE?: string;
};

/** 一条股东增减持 → RawNewsItem。无代码/名字/股东名返回 null。纯函数，便于单测。 */
export function shareholderChangeToRawItem(
  row: ShareholderRow,
): RawNewsItem | null {
  const code = (row.SECURITY_CODE ?? "").trim();
  const name = (row.SECURITY_NAME_ABBR ?? "").trim();
  const holder = (row.HOLDER_NAME ?? "").trim();
  const dir = (row.DIRECTION ?? "").trim();
  if (code === "" || name === "" || holder === "") return null;
  if (dir !== "增持" && dir !== "减持") return null;
  // DIRECTION 已表方向，占比取绝对值——否则「减持 + 负 CHANGE_RATE」拼出「减持-2.85%」双重否定。
  const rate =
    typeof row.CHANGE_RATE === "number"
      ? `${Number(Math.abs(row.CHANGE_RATE).toFixed(2))}%`
      : "";
  const hold =
    typeof row.HOLD_RATIO === "number"
      ? `（持股${Number(row.HOLD_RATIO.toFixed(2))}%）`
      : "";
  const title = `${name} 股东${holder}${dir}${rate}${hold}`;
  const date = (row.NOTICE_DATE ?? "").slice(0, 10);
  const publishedAt = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T18:00:00+08:00`)
    : new Date();
  return {
    externalId: `shhold-${code}-${date}-${holder}-${dir}`.slice(0, 120),
    title,
    url: `https://data.eastmoney.com/executive/${code}.html`,
    summary: title,
    publishedAt,
    eventType: dir,
    entityHints: [name, code],
  };
}

async function fetchLatestShareholder(): Promise<ShareholderRow[]> {
  const url =
    `${API}?reportName=RPT_SHARE_HOLDER_INCREASE&columns=ALL` +
    `&pageNumber=1&pageSize=500&sortColumns=NOTICE_DATE&sortTypes=-1`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://data.eastmoney.com/" },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`shareholder ${res.status}`);
  const j = (await res.json()) as { result?: { data?: ShareholderRow[] } };
  return j.result?.data ?? [];
}

/** 东财·股东增减持（覆盖池内个股）。tier=PRIMARY，subjectOnly。 */
export const eastmoneyShareholderChange: SourceDef = {
  key: "eastmoney-shareholder",
  name: "东方财富·股东增减持",
  tier: "PRIMARY",
  kind: "fund-flow",
  subjectOnly: true,
  async fetch(dict): Promise<RawNewsItem[]> {
    const covered = new Set(
      dict.flatMap((e) => (e.type === "STOCK" && e.ticker ? [e.ticker] : [])),
    );
    const rows = await fetchLatestShareholder();
    const out: RawNewsItem[] = [];
    for (const r of rows) {
      if (!covered.has((r.SECURITY_CODE ?? "").trim())) continue;
      const item = shareholderChangeToRawItem(r);
      if (item) out.push(item);
    }
    return out;
  },
};

/** 东财·董监高增减持（覆盖池内个股）。tier=PRIMARY，subjectOnly。 */
export const eastmoneyExecHold: SourceDef = {
  key: "eastmoney-exechold",
  name: "东方财富·董监高增减持",
  tier: "PRIMARY",
  kind: "fund-flow",
  subjectOnly: true,
  async fetch(dict): Promise<RawNewsItem[]> {
    const covered = new Set(
      dict.flatMap((e) => (e.type === "STOCK" && e.ticker ? [e.ticker] : [])),
    );
    const rows = await fetchLatestExecHold();
    const out: RawNewsItem[] = [];
    for (const r of rows) {
      if (!covered.has((r.SECURITY_CODE ?? "").trim())) continue;
      const item = holderChangeToRawItem(r);
      if (item) out.push(item);
    }
    return out;
  },
};
