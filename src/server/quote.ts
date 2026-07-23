// 相对导入（不用 ~ 别名）：让 cron 脚本走 tsx 也能引用 fetchQuote（tsx 不解析 tsconfig paths）。
import {
  parseSinaIndex,
  parseSinaQuote,
  parseTencentQuote,
  parseValuation,
  tickerToSecid,
  tickerToSymbol,
  type IndexMarket,
  type Quote,
  type Valuation,
} from "../lib/quote";

export type LiveQuote = Quote & { symbol: string };

/** 抓客观估值指标（东财 push2 JSON：市盈率动/市净率/总市值/流通市值/换手率）。失败返回 null（不抛）。 */
export async function fetchValuation(ticker: string): Promise<Valuation | null> {
  const secid = tickerToSecid(ticker);
  if (!secid) return null;
  try {
    const res = await fetch(
      `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}` +
        `&fields=f116,f117,f162,f167,f168&ut=fa5fd1943c7b386f172d6893dbfba10b`,
      {
        headers: { Referer: "https://quote.eastmoney.com" },
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
      },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { data?: Record<string, unknown> | null };
    if (!j.data) return null;
    return parseValuation(j.data);
  } catch {
    return null;
  }
}

/** 抓 A股实时行情：主源新浪、备源腾讯，均 GBK；任何失败返回 null（不抛）。 */
export async function fetchQuote(ticker: string): Promise<LiveQuote | null> {
  const symbol = tickerToSymbol(ticker);
  if (!symbol) return null;

  try {
    const res = await fetch(`https://hq.sinajs.cn/list=${symbol}`, {
      headers: { Referer: "https://finance.sina.com.cn" },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const raw = new TextDecoder("gbk").decode(await res.arrayBuffer());
      const q = parseSinaQuote(raw);
      if (q) return { ...q, symbol };
    }
  } catch {
    // fall through to backup source
  }

  try {
    const res = await fetch(`https://qt.gtimg.cn/q=${symbol}`, {
      headers: { Referer: "https://gu.qq.com" },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const raw = new TextDecoder("gbk").decode(await res.arrayBuffer());
      const q = parseTencentQuote(raw);
      if (q) return { ...q, symbol };
    }
  } catch {
    // give up
  }

  return null;
}

/** 抓近 N 日日K收盘序列（新浪），供实体页迷你走势图；任何失败返回 []（不抛）。 */
export async function fetchKline(ticker: string, days = 30): Promise<number[]> {
  const symbol = tickerToSymbol(ticker);
  if (!symbol) return [];
  try {
    const res = await fetch(
      `https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=${days}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Referer: "https://finance.sina.com.cn",
        },
        cache: "no-store",
      },
    );
    if (!res.ok) return [];
    const arr = (await res.json()) as { close?: string }[];
    return arr
      .map((d) => Number(d.close))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

/** 概览条覆盖的指数：沪深 → 港股 → 美股，顺序即展示顺序。 */
const INDEX_SYMBOLS: { symbol: string; label: string; market: IndexMarket }[] = [
  { symbol: "sh000001", label: "上证指数", market: "cn" },
  { symbol: "sz399001", label: "深证成指", market: "cn" },
  { symbol: "sz399006", label: "创业板指", market: "cn" },
  { symbol: "sh000688", label: "科创50", market: "cn" },
  { symbol: "sh000300", label: "沪深300", market: "cn" },
  { symbol: "rt_hkHSI", label: "恒生指数", market: "hk" },
  { symbol: "rt_hkHSTECH", label: "恒生科技", market: "hk" },
  { symbol: "gb_dji", label: "道琼斯", market: "us" },
  { symbol: "gb_ixic", label: "纳斯达克", market: "us" },
  { symbol: "gb_inx", label: "标普500", market: "us" },
];

export type IndexQuote = {
  symbol: string;
  label: string;
  market: IndexMarket;
  price: number;
  changePct: number;
};

/**
 * 抓主要指数行情（新浪，A股/港股/美股一次批量拿——实测混合 symbol 同一请求可返回）。
 * 港美在 A 股交易时段显示的是上一交易日收盘，属正常（各家财经端一致），UI 按市场分组标注。
 * 失败返回 []（不抛）。供首页市场概览条。
 */
export async function fetchIndexQuotes(): Promise<IndexQuote[]> {
  try {
    const list = INDEX_SYMBOLS.map((i) => i.symbol).join(",");
    const res = await fetch(`https://hq.sinajs.cn/list=${list}`, {
      headers: { Referer: "https://finance.sina.com.cn" },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const raw = new TextDecoder("gbk").decode(await res.arrayBuffer());
    const lines = raw.split("\n");
    const out: IndexQuote[] = [];
    for (const idx of INDEX_SYMBOLS) {
      // 精确匹配 `hq_str_<symbol>=`：symbol 之间存在子串关系（rt_hkHSI ⊂ 不了 HSTECH，
      // 但 sh000300/sh000688 之类未来易撞），松匹配会串行拿到别的指数。
      const line = lines.find((l) => l.includes(`hq_str_${idx.symbol}=`));
      if (!line) continue;
      const q = parseSinaIndex(line, idx.market);
      if (q) {
        out.push({
          symbol: idx.symbol,
          label: idx.label,
          market: idx.market,
          price: q.price,
          changePct: q.changePct,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}
