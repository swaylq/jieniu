// Decision Memory 纯逻辑（P4-3）。动作标签用 amber/灰，不用红绿（买卖不是涨跌）。price 仅观察。

export type DecisionAction = "BUY" | "ADD" | "TRIM" | "SELL" | "HOLD_REAFFIRM";

export const DECISION_ACTIONS: DecisionAction[] = [
  "BUY",
  "ADD",
  "TRIM",
  "SELL",
  "HOLD_REAFFIRM",
];

export const ACTION_LABEL: Record<DecisionAction, string> = {
  BUY: "买入",
  ADD: "加仓",
  TRIM: "减仓",
  SELL: "清仓",
  HOLD_REAFFIRM: "维持 / 重申",
};

export function normalizeAction(raw: string | null | undefined): DecisionAction {
  return DECISION_ACTIONS.includes(raw as DecisionAction)
    ? (raw as DecisionAction)
    : "HOLD_REAFFIRM";
}

/** 加仓侧(建仓/加/重申) vs 减仓侧(减/清)——仅用于 amber/灰视觉区分，非红绿、非涨跌。 */
export function actionTone(action: string): "accent" | "muted" {
  const a = normalizeAction(action);
  return a === "TRIM" || a === "SELL" ? "muted" : "accent";
}

/** 理由是否有效：去空后非空且不超长。 */
export function isValidReason(reason: string): boolean {
  const s = reason.trim();
  return s.length > 0 && s.length <= 1000;
}

/** 时间线按时间倒序（最新在前）。稳定：同刻按 id 兜底。 */
export function sortDecisionsDesc<T extends { createdAt: Date | string; id?: string }>(
  list: T[],
): T[] {
  return [...list].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    if (tb !== ta) return tb - ta;
    return (b.id ?? "").localeCompare(a.id ?? "");
  });
}
