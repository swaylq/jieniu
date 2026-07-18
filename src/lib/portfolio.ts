// Portfolio Memory 纯逻辑（P4-1）。成本/仓位仅「观察」，不做盈亏或买卖建议。

export type HoldingStatus = "WATCH" | "HOLDING" | "CLOSED";

export const HOLDING_STATUS_LABEL: Record<HoldingStatus, string> = {
  WATCH: "观察",
  HOLDING: "持仓",
  CLOSED: "已清仓",
};

export function normalizeHoldingStatus(raw: string | null | undefined): HoldingStatus {
  return raw === "HOLDING" ? "HOLDING" : raw === "CLOSED" ? "CLOSED" : "WATCH";
}

export type HoldingNumbers = {
  costBasis: number | null;
  shares: number | null;
  weight: number | null;
  targetWeight: number | null;
};

/** 清洗手录数值：成本/股数取非负，仓位/目标仓位限 0–100；非法一律置 null（不抛错，前端已提示）。 */
export function sanitizeHoldingNumbers(input: {
  costBasis?: number | null;
  shares?: number | null;
  weight?: number | null;
  targetWeight?: number | null;
}): HoldingNumbers {
  const nonNeg = (v: number | null | undefined) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  const pct = (v: number | null | undefined) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
  return {
    costBasis: nonNeg(input.costBasis),
    shares: nonNeg(input.shares),
    weight: pct(input.weight),
    targetWeight: pct(input.targetWeight),
  };
}

/** 按状态切分自选：持仓 vs 观察（CLOSED 不进任一，供历史）。 */
export function partitionPortfolio<T extends { status: string }>(
  items: T[],
): { holdings: T[]; watching: T[] } {
  const holdings: T[] = [];
  const watching: T[] = [];
  for (const i of items) {
    const s = normalizeHoldingStatus(i.status);
    if (s === "HOLDING") holdings.push(i);
    else if (s === "WATCH") watching.push(i);
  }
  return { holdings, watching };
}

/** 组合总仓位（观察用）：持仓已填 weight 之和，保留一位小数。 */
export function portfolioWeightTotal(holdings: { weight: number | null }[]): number {
  const sum = holdings.reduce((s, h) => s + (h.weight ?? 0), 0);
  return Math.round(sum * 10) / 10;
}

/** 目标 vs 当前仓位的方向（观察提示，非操作建议）：加/减/持平/未设。amber/灰，不涉红绿。 */
export function weightGapHint(
  weight: number | null,
  targetWeight: number | null,
): "below-target" | "above-target" | "on-target" | "unset" {
  if (weight == null || targetWeight == null) return "unset";
  const d = targetWeight - weight;
  if (Math.abs(d) < 0.5) return "on-target";
  return d > 0 ? "below-target" : "above-target";
}
