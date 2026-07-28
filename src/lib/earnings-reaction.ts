import { formatLocalDay, type Appointment } from "./disclosure";
import type { Bar } from "./kline";

/**
 * 历史财报日的股价反应（纯统计，不预测）。
 *
 * 借鉴富途「牛牛财报站 · 历史财报日涨跌幅」——它给「近 4 次平均绝对值 ±7.26%」这样一个
 * **历史基线**，让人对「这次财报可能带来多大波动」有个锚，而不必看懂财务。
 *
 * 与富途的差别（A 股必要的诚实处理）：A 股定期报告**多在盘后披露**，披露日当天的涨跌未必
 * 已反映财报；所以这里同时给「披露日当日」和「次一交易日」两列，让读者自己判断反应窗口。
 * 披露日恰逢非交易日（周末/停牌）时顺延到下一个有行情的交易日。
 *
 * 铁律：只统计已实际披露的报告；K 线没覆盖到的那次直接不产出——宁可少一条，不填空值。
 */

export type ReactionDay = { day: string; changePct: number };

export type Reaction = {
  reportKey: string;
  periodLabel: string;
  disclosedOn: string; // YYYY-MM-DD
  /** 披露日当日（非交易日顺延至下一交易日）。 */
  onDay: ReactionDay | null;
  /** 次一交易日。 */
  nextDay: ReactionDay | null;
};

/**
 * 把已披露的报告与日线对齐。`bars` 需按日期升序（`parseEastmoneyKlines`/`parseSinaKlines` 已保证）。
 * 结果按披露日降序，可选 `limit` 取最近 N 次。
 */
export function buildReactions(
  appointments: Appointment[],
  bars: Bar[],
  limit?: number,
): Reaction[] {
  if (bars.length === 0) return [];

  const out: Reaction[] = [];
  for (const a of appointments) {
    if (!a.actual) continue;
    const on = formatLocalDay(a.date);
    // 披露日当日；非交易日则顺延到下一个有行情的交易日。
    const idx = bars.findIndex((b) => b.day >= on);
    if (idx === -1) continue; // K 线没覆盖到（未来 / 数据窗口外）
    const onBar = bars[idx]!;
    const nextBar = bars[idx + 1];
    out.push({
      reportKey: a.reportKey,
      periodLabel: a.periodLabel,
      disclosedOn: on,
      onDay: { day: onBar.day, changePct: onBar.changePct },
      nextDay: nextBar
        ? { day: nextBar.day, changePct: nextBar.changePct }
        : null,
    });
  }

  out.sort((x, y) => y.disclosedOn.localeCompare(x.disclosedOn));
  return typeof limit === "number" ? out.slice(0, limit) : out;
}

/** 近 N 次披露日当日涨跌幅的**平均绝对值**——波动基线，不含方向。无样本返回 null。 */
export function avgAbsOnDay(reactions: Reaction[]): number | null {
  const vals = reactions
    .map((r) => r.onDay?.changePct)
    .filter((v): v is number => typeof v === "number");
  if (vals.length === 0) return null;
  const sum = vals.reduce((acc, v) => acc + Math.abs(v), 0);
  return Math.round((sum / vals.length) * 100) / 100;
}
