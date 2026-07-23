export type Quote = {
  name: string;
  price: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  changePct: number;
};

/** A股 ticker → 行情 symbol（sh/sz/bj 前缀）。无法识别返回 null。 */
export function tickerToSymbol(ticker: string): string | null {
  const t = ticker.trim();
  if (!/^\d{6}$/.test(t)) return null;
  const head = t[0];
  if (head === "6") return `sh${t}`;
  if (head === "0" || head === "3") return `sz${t}`;
  if (head === "8" || head === "4") return `bj${t}`;
  return null;
}

/** A股 ticker → 东财 push2 secid（沪=1.、深/创/北=0.）。无法识别返回 null。 */
export function tickerToSecid(ticker: string): string | null {
  const t = ticker.trim();
  if (!/^\d{6}$/.test(t)) return null;
  const head = t[0];
  if (head === "6") return `1.${t}`;
  if (head === "0" || head === "3" || head === "8" || head === "4") return `0.${t}`;
  return null;
}

/** 客观估值指标（非评级、不代表高估/低估判断）。任一取不到即为 null。 */
export type Valuation = {
  pe: number | null; // 市盈率(动)
  pb: number | null; // 市净率
  marketCap: number | null; // 总市值（元）
  floatCap: number | null; // 流通市值（元）
  turnover: number | null; // 换手率 %
};

function scaled(v: unknown, div: number): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return n / div;
}

/**
 * 解析东财 push2 `data`：f162 市盈率(动)×100、f167 市净率×100、
 * f116 总市值(元)、f117 流通市值(元)、f168 换手率×100。
 * PE/PB/市值 ≤0 或无意义（亏损/停牌）一律 null，避免误导；换手率允许 0。
 */
export function parseValuation(
  data: Record<string, unknown> | null | undefined,
): Valuation {
  const empty: Valuation = {
    pe: null,
    pb: null,
    marketCap: null,
    floatCap: null,
    turnover: null,
  };
  if (!data) return empty;
  const pos = (v: unknown, div: number): number | null => {
    const n = scaled(v, div);
    return n !== null && n > 0 ? n : null;
  };
  const turnover = scaled(data.f168, 100);
  return {
    pe: pos(data.f162, 100),
    pb: pos(data.f167, 100),
    marketCap: pos(data.f116, 1),
    floatCap: pos(data.f117, 1),
    turnover: turnover !== null && turnover >= 0 ? turnover : null,
  };
}

/** 估值卡是否有任何可展示指标（全 null 则整卡隐藏）。 */
export function hasValuation(v: Valuation): boolean {
  return (
    v.pe !== null ||
    v.pb !== null ||
    v.marketCap !== null ||
    v.turnover !== null
  );
}

function toQuote(
  name: string,
  price: number,
  prevClose: number,
  open: number,
  high: number,
  low: number,
): Quote | null {
  if (
    !name ||
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isFinite(prevClose) ||
    prevClose <= 0
  ) {
    return null;
  }
  return {
    name,
    price,
    prevClose,
    open,
    high,
    low,
    changePct: ((price - prevClose) / prevClose) * 100,
  };
}

/** 新浪：var hq_str_xxx="名称,今开,昨收,现价,最高,最低,..."; */
export function parseSinaQuote(raw: string): Quote | null {
  const payload = /="([^"]*)"/.exec(raw)?.[1] ?? "";
  if (!payload) return null;
  const f = payload.split(",");
  if (f.length < 6) return null;
  return toQuote(
    f[0] ?? "",
    Number(f[3] ?? ""),
    Number(f[2] ?? ""),
    Number(f[1] ?? ""),
    Number(f[4] ?? ""),
    Number(f[5] ?? ""),
  );
}

/** 指数所属市场。决定新浪返回的字段布局，同时供 UI 分组展示。 */
export type IndexMarket = "cn" | "hk" | "us";

/**
 * 解析新浪指数行情。**三个市场的字段布局完全不同**，不能共用 parseSinaQuote：
 * - `cn` `sh000001`：名称,今开,昨收,**最新**,最高,最低…      → 昨收自算涨跌幅
 * - `hk` `rt_hkHSI`：代码,名称,今开,昨收,最高,最低,**最新**,涨跌额,**涨跌幅**…
 * - `us` `gb_dji`  ：名称,**最新**,**涨跌幅**,时间,涨跌额…   → 涨跌幅接口直接给
 * 任一字段不可用返回 null（不抛），调用方跳过该条。
 */
export function parseSinaIndex(
  raw: string,
  market: IndexMarket,
): { price: number; changePct: number } | null {
  const payload = /="([^"]*)"/.exec(raw)?.[1] ?? "";
  if (!payload) return null;
  const f = payload.split(",");
  const num = (i: number) => Number(f[i] ?? "");

  let price: number;
  let changePct: number;
  if (market === "us") {
    if (f.length < 3) return null;
    price = num(1);
    changePct = num(2);
  } else if (market === "hk") {
    if (f.length < 9) return null;
    price = num(6);
    changePct = num(8);
  } else {
    if (f.length < 4) return null;
    price = num(3);
    const prevClose = num(2);
    if (!Number.isFinite(prevClose) || prevClose <= 0) return null;
    changePct = ((price - prevClose) / prevClose) * 100;
  }

  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(changePct)) return null;
  return { price, changePct };
}

/** 腾讯：v_xxx="1~名称~代码~现价~昨收~今开~..."; */
export function parseTencentQuote(raw: string): Quote | null {
  const payload = /="([^"]*)"/.exec(raw)?.[1] ?? "";
  if (!payload) return null;
  const f = payload.split("~");
  if (f.length < 6) return null;
  return toQuote(
    f[1] ?? "",
    Number(f[3] ?? ""),
    Number(f[4] ?? ""),
    Number(f[5] ?? ""),
    NaN,
    NaN,
  );
}
