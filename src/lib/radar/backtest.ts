/**
 * 信号效果回测（需求 §12）——纯函数、无 IO、可测。
 *
 * 回答的是：**这套判据到底有没有用**。做法是把信号生成日之后 1/3/5/10 个交易日的
 * 收益算出来，并且**同时算相对全 A 与相对所属行业的超额**——绝对收益在单边市里
 * 什么都证明不了（本轮真实数据里全 A 20 日是 -10%，任何选股都"跑输"或"跑赢"得莫名其妙）。
 *
 * 还要算**最大回撤**：一条 5 日后 +3% 的信号，如果中间先跌了 12%，对用户来说不是好信号。
 */

import type { RadarBar } from "./series";

export type ForwardWindow = 1 | 3 | 5 | 10;
export const WINDOWS: ForwardWindow[] = [1, 3, 5, 10];

export type ForwardResult = {
  /** 各窗口的绝对收益 % */
  abs: Partial<Record<ForwardWindow, number>>;
  /** 相对全 A 的超额（百分点） */
  vsMarket: Partial<Record<ForwardWindow, number>>;
  /** 相对所属行业的超额（百分点） */
  vsSector: Partial<Record<ForwardWindow, number>>;
  /** 信号后 10 个交易日内的最大回撤 %（正数表示回撤幅度） */
  maxDrawdown: number | null;
  /** 次日资金是否反转（当日净流入 → 次日净流出） */
  flowReversedNextDay: boolean | null;
};

/** 从 `from` 之后第 n 个交易日的累计收益（%）。数据不够返回 undefined。 */
export function forwardReturn(
  bars: RadarBar[],
  fromIndex: number,
  n: number,
): number | undefined {
  if (fromIndex < 0 || fromIndex + n >= bars.length) return undefined;
  let acc = 1;
  for (let i = fromIndex + 1; i <= fromIndex + n; i++)
    acc *= 1 + bars[i]!.changePct / 100;
  return (acc - 1) * 100;
}

/**
 * 信号后 `horizon` 个交易日内的最大回撤（%）。
 * 用**收盘价的累计净值**算：峰值之后跌得最深的那一段。
 */
export function maxDrawdownAfter(
  bars: RadarBar[],
  fromIndex: number,
  horizon = 10,
): number | null {
  if (fromIndex < 0 || fromIndex + 1 >= bars.length) return null;
  let nav = 1;
  let peak = 1;
  let worst = 0;
  const end = Math.min(bars.length - 1, fromIndex + horizon);
  for (let i = fromIndex + 1; i <= end; i++) {
    nav *= 1 + bars[i]!.changePct / 100;
    peak = Math.max(peak, nav);
    worst = Math.max(worst, (peak - nav) / peak);
  }
  return worst * 100;
}

export type EvalInput = {
  bars: RadarBar[];
  /** 信号基准交易日在 `bars` 里的下标 */
  index: number;
  marketBars: RadarBar[];
  marketIndex: number;
  sectorBars?: RadarBar[];
  sectorIndex?: number;
};

export function evaluateSignal(i: EvalInput): ForwardResult {
  const abs: ForwardResult["abs"] = {};
  const vsMarket: ForwardResult["vsMarket"] = {};
  const vsSector: ForwardResult["vsSector"] = {};

  for (const n of WINDOWS) {
    const r = forwardReturn(i.bars, i.index, n);
    if (r === undefined) continue;
    abs[n] = r;
    const m = forwardReturn(i.marketBars, i.marketIndex, n);
    if (m !== undefined) vsMarket[n] = r - m;
    if (i.sectorBars && i.sectorIndex !== undefined) {
      const s = forwardReturn(i.sectorBars, i.sectorIndex, n);
      if (s !== undefined) vsSector[n] = r - s;
    }
  }

  const today = i.bars[i.index];
  const next = i.bars[i.index + 1];
  const flowReversedNextDay =
    today?.netAmount != null && next?.netAmount != null
      ? today.netAmount > 0 && next.netAmount < 0
      : null;

  return {
    abs,
    vsMarket,
    vsSector,
    maxDrawdown: maxDrawdownAfter(i.bars, i.index),
    flowReversedNextDay,
  };
}

export type Bucket = {
  label: string;
  n: number;
  /** 各窗口相对全 A 超额的均值 */
  meanVsMarket: Partial<Record<ForwardWindow, number>>;
  /** 各窗口相对全 A 超额为正的比例 */
  hitRate: Partial<Record<ForwardWindow, number>>;
  meanVsSector: Partial<Record<ForwardWindow, number>>;
  meanMaxDrawdown: number | null;
  flowReversalRate: number | null;
};

/** 按信号类型分桶统计（§12：分别统计三种信号的效果）。 */
export function summarize(
  label: string,
  results: ForwardResult[],
): Bucket {
  const meanVsMarket: Bucket["meanVsMarket"] = {};
  const hitRate: Bucket["hitRate"] = {};
  const meanVsSector: Bucket["meanVsSector"] = {};
  for (const n of WINDOWS) {
    const xs = results
      .map((r) => r.vsMarket[n])
      .filter((v): v is number => v !== undefined);
    if (xs.length > 0) {
      meanVsMarket[n] = xs.reduce((a, b) => a + b, 0) / xs.length;
      hitRate[n] = xs.filter((v) => v > 0).length / xs.length;
    }
    const ys = results
      .map((r) => r.vsSector[n])
      .filter((v): v is number => v !== undefined);
    if (ys.length > 0)
      meanVsSector[n] = ys.reduce((a, b) => a + b, 0) / ys.length;
  }
  const dds = results
    .map((r) => r.maxDrawdown)
    .filter((v): v is number => v !== null);
  const revs = results
    .map((r) => r.flowReversedNextDay)
    .filter((v): v is boolean => v !== null);
  return {
    label,
    n: results.length,
    meanVsMarket,
    hitRate,
    meanVsSector,
    meanMaxDrawdown:
      dds.length > 0 ? dds.reduce((a, b) => a + b, 0) / dds.length : null,
    flowReversalRate:
      revs.length > 0 ? revs.filter(Boolean).length / revs.length : null,
  };
}
