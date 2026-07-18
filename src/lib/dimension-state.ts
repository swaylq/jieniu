// 维度状态跨越纯逻辑（P4-8）。只在 thesis 维度「跨越」到新方向时才提醒——宁少毋滥。amber/灰，非红绿。

export type DimState = "neutral" | "bullish" | "bearish";

export const DIM_STATE_LABEL: Record<DimState, string> = {
  neutral: "中性",
  bullish: "偏兑现",
  bearish: "偏风险",
};

/** 由一个维度近期材料级信号的方向汇总出当前状态：偏兑现 / 偏风险 / 中性。 */
export function dimensionState(signals: { direction: string }[]): DimState {
  let bull = 0;
  let bear = 0;
  for (const s of signals) {
    if (s.direction === "bull") bull++;
    else if (s.direction === "bear") bear++;
  }
  if (bull > bear) return "bullish";
  if (bear > bull) return "bearish";
  return "neutral";
}

/** 是否发生「跨越」：状态变了、且新状态是有方向的（转中性=平息，不打扰）。 */
export function crossedState(
  prev: DimState,
  next: DimState,
): { crossed: boolean; from: DimState; to: DimState } {
  return { crossed: prev !== next && next !== "neutral", from: prev, to: next };
}
