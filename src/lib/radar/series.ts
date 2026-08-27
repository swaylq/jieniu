/**
 * 机会雷达的时序基元（纯函数、无 IO、可测）。
 *
 * 需求 §3 的铁律「不能直接按净流入多少亿排名」落在这里：所有横截面比较**先转分位**，
 * 所有「相对自身」的判断走 `selfPercentile`。分位是无量纲的，大行业与小行业、
 * 大市值与小市值才可比——这和 `lib/rotation.ts` 用 rank-sum 而不是加权求和是同一个理由。
 *
 * 约定：`bars` 一律**按交易日升序**，最后一根是最新交易日。
 */

export type RadarBar = {
  day: string; // YYYY-MM-DD
  close: number;
  changePct: number;
  amount: number | null; // 成交额（元）
  netAmount: number | null; // 主力净额（元）
  netRatio: number | null; // 主力净额 / 成交额
  turnoverRate: number | null; // 换手率 %
  /**
   * 超大单净额（元）。新浪同一个接口的 `r0_net`——2026-08-27 之前解析器直接丢弃了它。
   * 主力 = 超大单 + 大单，所以「大单净额」= `netAmount - netAmountXl`。
   * 回填未到位的历史行为空；判据要能容忍缺失。
   */
  netAmountXl?: number | null;
  /** 前复权四价（腾讯 fqkline）。回填未到位时为空——判据要能容忍缺失 */
  open?: number | null;
  high?: number | null;
  low?: number | null;
  adjClose?: number | null;
};

/**
 * N 个交易日累计涨幅（%）＝最近 N 根 `changePct` **连乘**。
 *
 * 为什么不用「收盘价两点比」：新浪给的 `trade` 是**未复权**收盘价，而 `changeratio`
 * 是当日官方涨跌幅（已含除权除息处理）。A 股 6~7 月是分红旺季——实测 60 日窗口里
 * **1137/5334 只**（21%）的收盘价跳变与当日涨跌幅对不上，全是除息缺口。
 * 用收盘价比会把「分红 1 元」读成「跌了 10%」，20 日窗口上整批消费股会被误判成暴跌。
 *
 * 历史不足 N+1 根返回 null（不拿最早那根凑数）。
 */
export function returnOverDays(bars: RadarBar[], n: number): number | null {
  if (bars.length < n + 1) return null;
  let acc = 1;
  for (const b of bars.slice(-n)) acc *= 1 + b.changePct / 100;
  return (acc - 1) * 100;
}

/** 最近 N 天里主力净额为正的天数。净额缺失的那天两边都不算。 */
export function positiveFlowDays(bars: RadarBar[], n: number): number {
  return bars
    .slice(-n)
    .filter((b) => b.netAmount !== null && b.netAmount > 0).length;
}

/** 最近 N 天主力净额合计（元）。全缺返回 null。 */
export function netFlowSum(bars: RadarBar[], n: number): number | null {
  const xs = bars
    .slice(-n)
    .map((b) => b.netAmount)
    .filter((v): v is number => v !== null);
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0);
}

/**
 * 分位排名 0..100：`value` 在 `sample` 里的位置。
 * 空样本返回 50（中性）——返回 0 会把「没数据」读成「最差」，是静默的错误结论。
 */
export function percentileRank(sample: number[], value: number): number {
  const xs = sample.filter((v) => Number.isFinite(v));
  if (xs.length === 0) return 50;
  if (xs.length === 1) return 50;
  const below = xs.filter((v) => v < value).length;
  const equal = xs.filter((v) => v === value).length;
  // 秩的 min-max 归一：样本最小值→0、最大值→100。并列取**中点秩**（3 个并列最小值
  // 各得 1/(n-1)，不是 0）——否则同分的项会因为排序先后拿到不同的分。
  // 样本外的值（`selfPercentile` 的今天不在历史里）落在 [0,100] 之外，clamp 收口。
  const pos = below + (equal > 0 ? (equal - 1) / 2 : 0);
  return clamp100((pos / (xs.length - 1)) * 100);
}

/**
 * 当前值在**自身历史**里的分位（§3 第 4 项「相对自身过去 60 日的异常程度」）。
 * 样本不足 `minSample` 返回 null——历史太短谈不上「异常」，宁可留空也不编。
 */
export function selfPercentile(
  bars: RadarBar[],
  pick: (b: RadarBar) => number | null,
  lookback: number,
  minSample = 20,
): number | null {
  if (bars.length === 0) return null;
  const cur = pick(bars[bars.length - 1]!);
  if (cur === null) return null;
  const hist = bars
    .slice(-lookback - 1, -1)
    .map(pick)
    .filter((v): v is number => v !== null);
  if (hist.length < minSample) return null;
  return percentileRank(hist, cur);
}

/** 当日成交额 ÷ 过去 N 日均额。**均额不含当日**，否则放量会被自己稀释。 */
export function amountRatioVs(bars: RadarBar[], n: number): number | null {
  if (bars.length < 2) return null;
  const today = bars[bars.length - 1]!.amount;
  if (today === null || today <= 0) return null;
  const hist = bars
    .slice(-n - 1, -1)
    .map((b) => b.amount)
    .filter((v): v is number => v !== null && v > 0);
  if (hist.length === 0) return null;
  const avg = hist.reduce((a, b) => a + b, 0) / hist.length;
  if (!(avg > 0)) return null;
  return today / avg;
}

/** 均值。空数组返回 null（不返回 0——0 是个有意义的值，会被误读）。 */
export function mean(xs: number[]): number | null {
  const ys = xs.filter((v) => Number.isFinite(v));
  if (ys.length === 0) return null;
  return ys.reduce((a, b) => a + b, 0) / ys.length;
}

/** 把任意实数压到 0..100（clamp）。 */
export function clamp100(v: number): number {
  return Math.max(0, Math.min(100, v));
}
