import type { DriftLevel } from "./drift";

// 投资画像纯逻辑（P4-6）。自我认知工具，非风险测评结论、非荐股依据。回灌 drift 语气/档位。

export type InvestorStyle = "value" | "growth" | "trade";
export type RiskLevel = "conservative" | "balanced" | "aggressive";
export type HoldPeriod = "long" | "swing";

export const STYLE_OPTIONS: { value: InvestorStyle; label: string; hint: string }[] = [
  { value: "value", label: "价值", hint: "看重估值与现金流，逢低布局" },
  { value: "growth", label: "成长", hint: "看重赛道与增速，愿为成长付溢价" },
  { value: "trade", label: "交易", hint: "看重趋势与节奏，波段进出" },
];

export const RISK_OPTIONS: { value: RiskLevel; label: string; hint: string }[] = [
  { value: "conservative", label: "保守", hint: "求稳，回撤敏感" },
  { value: "balanced", label: "均衡", hint: "攻守兼顾" },
  { value: "aggressive", label: "激进", hint: "求高收益，能扛波动" },
];

export const HOLD_OPTIONS: { value: HoldPeriod; label: string; hint: string }[] = [
  { value: "long", label: "长线", hint: "以年为单位持有" },
  { value: "swing", label: "波段", hint: "以周 / 月为单位进出" },
];

export const STYLE_LABEL: Record<InvestorStyle, string> = {
  value: "价值",
  growth: "成长",
  trade: "交易",
};
export const RISK_LABEL: Record<RiskLevel, string> = {
  conservative: "保守",
  balanced: "均衡",
  aggressive: "激进",
};
export const HOLD_LABEL: Record<HoldPeriod, string> = {
  long: "长线",
  swing: "波段",
};

export function normalizeStyle(v: string | null | undefined): InvestorStyle | null {
  return v === "value" || v === "growth" || v === "trade" ? v : null;
}
export function normalizeRisk(v: string | null | undefined): RiskLevel | null {
  return v === "conservative" || v === "balanced" || v === "aggressive" ? v : null;
}
export function normalizeHold(v: string | null | undefined): HoldPeriod | null {
  return v === "long" || v === "swing" ? v : null;
}

/** 画像回灌 drift 档位：激进者更易「越跌越加」，升级挑战；保守者本就谨慎，温和化。 */
export function adjustDriftLevel(
  level: DriftLevel,
  risk: RiskLevel | null | undefined,
): DriftLevel {
  if (level === "none") return "none";
  if (risk === "aggressive") return "strong";
  if (risk === "conservative" && level === "strong") return "soft";
  return level;
}

/** 画像回灌 drift 语气提示（注入 AI prompt；空串表示不特别调整）。 */
export function driftToneHint(risk: RiskLevel | null | undefined): string {
  if (risk === "aggressive")
    return "对方是激进型投资者、更容易因为下跌就加仓，语气可以更直接地质疑。";
  if (risk === "conservative")
    return "对方是保守型投资者、本就谨慎，语气温和些、以确认为主。";
  return "";
}

/** 画像是否已填（至少选了风格或风险）——决定 UI 是否显示「已建立画像」。 */
export function hasProfile(p: {
  style?: string | null;
  riskLevel?: string | null;
}): boolean {
  return !!(normalizeStyle(p.style) ?? normalizeRisk(p.riskLevel));
}
