import { MATERIAL_ALERT_THRESHOLD } from "./thesis-status";

/**
 * 逻辑影响 6 级（P5-2）——ChatGPT 批评：把「这条动态对你的投资逻辑是增强还是削弱」
 * 统一成一眼可扫的显式标签，别让用户每条都点开。纯规则、零 AI：由已有信号的
 * 方向(direction) × 材料度(materiality 0–100) 推导，不新调 AI、不编数字。
 *
 * 6 级：明显增强 / 轻微增强 / 无实质影响 / 轻微削弱 / 明显削弱 / 尚无法判断
 *
 * 颜色遵守铁律：红/绿只给真实价格。thesis 影响用 amber(增强/兑现) 与 ink 灰(削弱/风险)
 * 区分方向——与 P4-8 维度状态卡一致（bullish→amber、其余→ink），不用红绿。
 */
export type LogicImpactLevel =
  | "strong_up"
  | "mild_up"
  | "none"
  | "mild_down"
  | "strong_down"
  | "unclear";

/** up=增强(amber) / down=削弱(ink 灰) / neutral=无实质或未知(muted) */
export type ImpactTone = "up" | "down" | "neutral";

export type LogicImpact = {
  level: LogicImpactLevel;
  label: string;
  tone: ImpactTone;
};

/** 明显 vs 轻微 的材料度分界（材料级下限沿用 thesis 的 MATERIAL_ALERT_THRESHOLD=40）。 */
export const STRONG_IMPACT_THRESHOLD = 70;

const IMPACT: Record<LogicImpactLevel, Omit<LogicImpact, "level">> = {
  strong_up: { label: "明显增强", tone: "up" },
  mild_up: { label: "轻微增强", tone: "up" },
  none: { label: "无实质影响", tone: "neutral" },
  mild_down: { label: "轻微削弱", tone: "down" },
  strong_down: { label: "明显削弱", tone: "down" },
  unclear: { label: "尚无法判断", tone: "neutral" },
};

export function classifyLogicImpact(input: {
  direction: string;
  materiality: number;
}): LogicImpact {
  const m = Number.isFinite(input.materiality) ? input.materiality : 0;
  const build = (level: LogicImpactLevel): LogicImpact => ({
    level,
    ...IMPACT[level],
  });

  if (input.direction === "bull") {
    if (m >= STRONG_IMPACT_THRESHOLD) return build("strong_up");
    if (m >= MATERIAL_ALERT_THRESHOLD) return build("mild_up");
    return build("none"); // 偏兑现但太弱，不构成实质影响
  }
  if (input.direction === "bear") {
    if (m >= STRONG_IMPACT_THRESHOLD) return build("strong_down");
    if (m >= MATERIAL_ALERT_THRESHOLD) return build("mild_down");
    return build("none");
  }
  // 方向不明（中性 / 未知）
  if (m >= MATERIAL_ALERT_THRESHOLD) return build("unclear"); // 触及了但方向未定
  return build("none");
}

/** UI 徽标类名：增强 amber、削弱 ink 灰、无实质/未知 muted。不用红绿（铁律）。 */
export function impactBadgeClass(tone: ImpactTone): string {
  if (tone === "up") {
    return "rounded bg-brand/15 px-1.5 py-0.5 text-[11px] font-semibold text-brand";
  }
  if (tone === "down") {
    return "rounded border border-line px-1.5 py-0.5 text-[11px] font-semibold text-ink";
  }
  return "rounded px-1.5 py-0.5 text-[11px] font-medium text-muted";
}
