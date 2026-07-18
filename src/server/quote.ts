// 相对导入（不用 ~ 别名）：让 cron 脚本走 tsx 也能引用 fetchQuote（tsx 不解析 tsconfig paths）。
import {
  parseSinaQuote,
  parseTencentQuote,
  parseValuation,
  tickerToSecid,
  tickerToSymbol,
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

const INDEX_SYMBOLS = [
  { symbol: "sh000001", label: "上证指数" },
  { symbol: "sz399001", label: "深证成指" },
  { symbol: "sz399006", label: "创业板指" },
  { symbol: "sh000688", label: "科创50" },
  { symbol: "sh000300", label: "沪深300" },
] as const;

export type IndexQuote = {
  symbol: string;
  label: string;
  price: number;
  changePct: number;
};

/** 抓主要指数行情（新浪，一次批量）；失败返回 []（不抛）。供首页市场概览条。 */
export async function fetchIndexQuotes(): Promise<IndexQuote[]> {
  try {
    const list = INDEX_SYMBOLS.map((i) => i.symbol).join(",");
    const res = await fetch(`https://hq.sinajs.cn/list=${list}`, {
      headers: { Referer: "https://finance.sina.com.cn" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const raw = new TextDecoder("gbk").decode(await res.arrayBuffer());
    const lines = raw.split("\n");
    const out: IndexQuote[] = [];
    for (const idx of INDEX_SYMBOLS) {
      const line = lines.find((l) => l.includes(idx.symbol));
      if (!line) continue;
      const q = parseSinaQuote(line);
      if (q) {
        out.push({
          symbol: idx.symbol,
          label: idx.label,
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
