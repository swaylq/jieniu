// Thesis Drift Guard 纯逻辑（P4-5）。判定是否/多强地挑战一次决策——防「因为跌了而非逻辑成立去加仓」。
// 挑战=促自查，非买卖指令。颜色 amber/灰。

export type DriftLevel = "none" | "soft" | "strong";

export type DriftFacts = {
  action: string; // BUY | ADD | TRIM | SELL | HOLD_REAFFIRM
  bullMaterial: number; // 近期材料级「偏兑现」信号数
  bearMaterial: number; // 近期材料级「偏风险」信号数
};

export type DriftVerdict = { shouldChallenge: boolean; level: DriftLevel };

/** 只挑战建仓侧(BUY/ADD)且近期有偏风险动态时——宁少毋滥。风险占优→strong，风险存在但不占优→soft。 */
export function driftDecision(facts: DriftFacts): DriftVerdict {
  const isBuild = facts.action === "BUY" || facts.action === "ADD";
  if (!isBuild || facts.bearMaterial <= 0) {
    return { shouldChallenge: false, level: "none" };
  }
  const strong = facts.bearMaterial > facts.bullMaterial;
  return { shouldChallenge: true, level: strong ? "strong" : "soft" };
}

export function driftHeadline(level: DriftLevel): string {
  return level === "strong"
    ? "先停一下——你在加仓，但逻辑近期偏风险"
    : "加仓前，值得对照一下你的原始逻辑";
}

/** AI 不可用时的规则兜底话术（不编数字，只组织已知事实）。 */
export function fallbackChallenge(
  name: string,
  originalReason: string | null,
): string {
  const because = originalReason ? `你当初记下的理由是「${originalReason}」。` : "";
  return `你正准备加仓${name}。${because}但近期出现了偏风险的动态。加仓前先自问：你现在加仓，是因为当初的投资逻辑仍然成立、有新的兑现证据，还是仅仅因为价格跌了、想摊低成本？如果说不出「逻辑仍成立」的理由，也许值得再等一等。最终决策在你。`;
}
