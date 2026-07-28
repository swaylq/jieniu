/**
 * 估值的**对照系**：当前 PE 在自己历史上的分位 + 同行业中位数。
 *
 * 借鉴富途「牛牛财报站 · 公司估值」——它给「当前市盈率 66.6，超过历史（1年）27%」，
 * 并在 PE 带状图上叠「合理区间 / 行业均值 / 标普500」三条基准线。价值不在那个数字本身，
 * 而在**参照物**：单看 66.6 谁也不知道贵不贵，配上分位与同行中位数就有了判断的地基。
 * 解牛的估值卡此前是单值，正缺这一层。
 *
 * 铁律：
 *  ① 这是客观统计，不是估值判断——不出「低估/高估」结论，只摆分位与对照。
 *  ② 亏损（PE<=0）一律剔除：负 PE 进中位数、算分位都没有意义，不编。
 *  ③ 样本不够就不给分位（宁可空着）。
 */

export type ValuationRow = {
  day: string; // YYYY-MM-DD
  peTtm: number | null;
  pbMrq: number | null;
  psTtm: number | null;
  boardCode: string | null;
  boardName: string | null;
};

/** 可信分位所需的最少历史观测数（约半年交易日）。低于此不给分位。 */
export const MIN_HISTORY = 60;
/** 行业中位数所需的最少有效同行数。 */
export const MIN_PEERS = 5;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** 东财 `RPT_VALUEANALYSIS_DET` 响应 → 行数组（保持源顺序：按 TRADE_DATE 倒序）。 */
export function parseValuationRows(json: unknown): ValuationRow[] {
  const data = (json as { result?: { data?: unknown } } | null)?.result?.data;
  if (!Array.isArray(data)) return [];
  const out: ValuationRow[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const day = typeof r.TRADE_DATE === "string" ? r.TRADE_DATE.slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    out.push({
      day,
      peTtm: num(r.PE_TTM),
      pbMrq: num(r.PB_MRQ),
      psTtm: num(r.PS_TTM),
      boardCode: str(r.BOARD_CODE),
      boardName: str(r.BOARD_NAME),
    });
  }
  return out;
}

/** 当前值高于历史中多少比例的观测（0-100，整数）。空历史 → null。 */
export function percentileBelow(history: number[], current: number): number | null {
  if (history.length === 0) return null;
  const below = history.filter((v) => v < current).length;
  return Math.round((below / history.length) * 100);
}

/** 中位数，剔除非正数。全非正或空 → null。 */
export function medianPositive(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

export type ValuationContext = {
  current: number;
  /** 当前 PE 高于自身历史多少比例的交易日。样本不足 → null。 */
  percentile: number | null;
  /** 参与分位计算的有效历史观测数。 */
  sampleSize: number;
  /** 同行业 PE_TTM 中位数。有效同行不足 → null。 */
  industryMedian: number | null;
  boardName: string | null;
};

/**
 * `history` 需按交易日**倒序**（源即如此），第一行是最新。
 * 当前 PE 非正（亏损）时整块返回 null——分位与同行对照都无意义。
 */
export function buildValuationContext({
  history,
  peerPes,
  boardName,
}: {
  history: ValuationRow[];
  peerPes: number[];
  boardName: string | null;
}): ValuationContext | null {
  const latest = history[0];
  const current = latest?.peTtm ?? null;
  if (current === null || current <= 0) return null;

  const past = history
    .map((r) => r.peTtm)
    .filter((v): v is number => v !== null && v > 0);

  return {
    current,
    percentile: past.length >= MIN_HISTORY ? percentileBelow(past, current) : null,
    sampleSize: past.length,
    industryMedian:
      peerPes.filter((v) => v > 0).length >= MIN_PEERS
        ? medianPositive(peerPes)
        : null,
    boardName,
  };
}
