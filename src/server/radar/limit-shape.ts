import { tickerToSymbol } from "../../lib/quote";

/**
 * 一字涨停核验（需求 §5：排除一字涨停股）。
 *
 * `MarketDaily` 只有收盘价，判不出「一字」——一字板的特征是**开=高=低=收**，
 * 需要日内四价。所以这里单独去拉几根 K 线，且**只对最终入选的那几只**拉
 * （≤8 只，一次几百毫秒），不是全市场 5300 只。
 *
 * 相对导入：让 `src/scripts/*.ts` 走 tsx 也能引用。
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export type Shape = {
  /** 最新一根是不是一字（开=高=低=收） */
  oneWord: boolean;
  /** 从最新一根往前数，连续涨停几天 */
  consecutiveLimitUps: number;
};

type Row = { open: number; high: number; low: number; close: number };

/** 新浪 K 线 → 四价数组（升序）。结构不对返回 []。 */
export function parseOHLC(json: unknown): Row[] {
  if (!Array.isArray(json)) return [];
  const out: Row[] = [];
  for (const it of json) {
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    const nums = [r.open, r.high, r.low, r.close].map((v) => Number(v));
    if (nums.some((n) => !Number.isFinite(n) || n <= 0)) continue;
    out.push({ open: nums[0]!, high: nums[1]!, low: nums[2]!, close: nums[3]! });
  }
  return out;
}

/** 涨停阈值按板块分档（与 `lib/radar/aggregate.ts` 的 `isLimitUp` 同一组数）。 */
function limitPct(ticker: string): number {
  if (ticker.startsWith("30") || ticker.startsWith("688")) return 19.5;
  if (ticker.startsWith("8") || ticker.startsWith("4") || ticker.startsWith("92"))
    return 29.5;
  return 9.8;
}

export function shapeOf(ticker: string, rows: Row[]): Shape {
  if (rows.length === 0) return { oneWord: false, consecutiveLimitUps: 0 };
  const last = rows[rows.length - 1]!;
  const oneWord =
    last.open === last.high && last.high === last.low && last.low === last.close;
  const lim = limitPct(ticker);
  let n = 0;
  for (let i = rows.length - 1; i >= 1; i--) {
    const chg = (rows[i]!.close / rows[i - 1]!.close - 1) * 100;
    if (chg >= lim) n++;
    else break;
  }
  return { oneWord, consecutiveLimitUps: n };
}

/** 拉最近 `days` 根日线并判形态。取不到返回 null（区分「没查到」与「不是一字」）。 */
export async function fetchShape(
  ticker: string,
  days = 8,
): Promise<Shape | null> {
  const symbol = tickerToSymbol(ticker);
  if (!symbol) return null;
  try {
    const res = await fetch(
      `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=${days}`,
      {
        headers: { "User-Agent": UA, Referer: "https://finance.sina.com.cn" },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return null;
    const rows = parseOHLC(await res.json());
    return rows.length === 0 ? null : shapeOf(ticker, rows);
  } catch (e) {
    // 不裸 catch：源端点变了会 100% 失败，静默会让「一字板过滤」永久失效
    console.error(
      `[limit-shape] ${ticker} 取 K 线失败：`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}
