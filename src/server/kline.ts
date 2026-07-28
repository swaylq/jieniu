// 相对导入（不用 ~ 别名）：让 src/scripts/*.ts 走 tsx 也能引用（tsx 不解析 tsconfig paths）。
import { parseEastmoneyKlines, parseSinaKlines, type Bar } from "../lib/kline";
import { tickerToSecid, tickerToSymbol } from "../lib/quote";

/**
 * 日线抓取：主源东财 push2his，失败回退新浪。
 * 东财 push2 对本节点**间歇封锁**（估值卡已因此加过腾讯兜底），日线同理不押单一主机。
 * 失败返回空数组（不抛）——调用方据此不渲染该模块。
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function fromEastmoney(ticker: string, beg: string): Promise<Bar[]> {
  const secid = tickerToSecid(ticker);
  if (!secid) return [];
  const url =
    `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}` +
    `&klt=101&fqt=1&beg=${beg}&end=20500101&fields1=f1&fields2=f51,f53,f59` +
    `&ut=fa5fd1943c7b386f172d6893dbfba10b`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://quote.eastmoney.com" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  return parseEastmoneyKlines(await res.json());
}

async function fromSina(ticker: string, datalen: number): Promise<Bar[]> {
  const symbol = tickerToSymbol(ticker);
  if (!symbol) return [];
  const url =
    `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData` +
    `?symbol=${symbol}&scale=240&ma=no&datalen=${datalen}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://finance.sina.com.cn" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  return parseSinaKlines(await res.json());
}

/**
 * 取该股最近 `years` 年的日线。两源都拿不到则返回空数组。
 * 用于「历史财报日涨跌幅」——覆盖 2 年约 8 个报告期，够给出「近 4 次」基线。
 */
export async function fetchDailyBars(
  ticker: string,
  years = 2,
  now: Date = new Date(),
): Promise<Bar[]> {
  const from = new Date(now.getFullYear() - years, now.getMonth(), now.getDate());
  const beg = `${from.getFullYear()}${String(from.getMonth() + 1).padStart(2, "0")}${String(from.getDate()).padStart(2, "0")}`;

  try {
    const bars = await fromEastmoney(ticker, beg);
    if (bars.length > 0) return bars;
  } catch (e) {
    // 记日志不静默：源端点变了会 100% 失败，裸 catch 会零痕迹永久跳过。
    console.error("[kline] eastmoney failed:", e instanceof Error ? e.message : e);
  }

  try {
    return await fromSina(ticker, Math.min(1023, years * 250 + 20));
  } catch (e) {
    console.error("[kline] sina failed:", e instanceof Error ? e.message : e);
    return [];
  }
}
