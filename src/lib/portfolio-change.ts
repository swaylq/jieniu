import { MATERIAL_ALERT_THRESHOLD } from "./thesis-status";

// 「今天你的组合变了什么」纯逻辑（P4-4）。方向 = 逻辑增强/削弱/未变；amber(增强)/灰(削弱)，非红绿、非涨跌。

export type ChangeDirection = "strengthened" | "weakened" | "unchanged";

export const CHANGE_LABEL: Record<ChangeDirection, string> = {
  strengthened: "逻辑增强",
  weakened: "逻辑削弱",
  unchanged: "逻辑未变",
};

/** amber(增强/偏兑现) vs 灰(削弱/偏风险)——非红绿。 */
export function changeTone(d: ChangeDirection): "accent" | "muted" {
  return d === "strengthened" ? "accent" : "muted";
}

/** 观察建议（促自查，非操作指令）。 */
export function changeObservation(d: ChangeDirection): string {
  if (d === "strengthened")
    return "偏兑现方向的动态在增多，可对照你的持仓逻辑复核是否仍成立。";
  if (d === "weakened")
    return "出现偏风险的动态，建议回看你当初记的证伪条件是否被触及。";
  return "";
}

export type ChangeSignal = {
  dimensionKey: string;
  direction: string; // bull | bear | neutral
  materiality: number;
  note: string;
};

export type PortfolioChangeItem = {
  entityId: string;
  name: string;
  direction: ChangeDirection;
  topDimension: string;
  topNote: string;
  materialCount: number;
  signalCount: number;
};

/** 一支持仓近期信号 → 逻辑增强/削弱/未变。仅材料级(≥阈值)信号才算「变」——宁少毋滥。 */
export function rollUpHoldingChange(
  entityId: string,
  name: string,
  signals: ChangeSignal[],
): PortfolioChangeItem {
  const material = signals.filter((s) => s.materiality >= MATERIAL_ALERT_THRESHOLD);
  if (material.length === 0) {
    return {
      entityId,
      name,
      direction: "unchanged",
      topDimension: "",
      topNote: "",
      materialCount: 0,
      signalCount: signals.length,
    };
  }
  const top = material.reduce((a, b) => (b.materiality > a.materiality ? b : a));
  const bull = material.filter((s) => s.direction === "bull").length;
  const bear = material.filter((s) => s.direction === "bear").length;
  const direction: ChangeDirection =
    bull > bear
      ? "strengthened"
      : bear > bull
        ? "weakened"
        : top.direction === "bull"
          ? "strengthened"
          : top.direction === "bear"
            ? "weakened"
            : "unchanged";
  return {
    entityId,
    name,
    direction,
    topDimension: top.dimensionKey,
    topNote: top.note,
    materialCount: material.length,
    signalCount: signals.length,
  };
}

/** 切分：有变化(增强/削弱)在前(材料多者优先)，未变归静音。 */
export function partitionPortfolioChange(items: PortfolioChangeItem[]): {
  changed: PortfolioChangeItem[];
  muted: PortfolioChangeItem[];
} {
  const changed = items
    .filter((i) => i.direction !== "unchanged")
    .sort(
      (a, b) => b.materialCount - a.materialCount || b.signalCount - a.signalCount,
    );
  const muted = items.filter((i) => i.direction === "unchanged");
  return { changed, muted };
}

export type ReviewSummary = {
  strengthened: number;
  weakened: number;
  unchanged: number;
  total: number;
  headline: string;
};

/** 周报/月报汇总（P5-10）：把一组持仓变化数成「X 增强 · Y 风险 · Z 无变化」一句话。纯规则、非涨跌预测。 */
export function summarizeReview(items: PortfolioChangeItem[]): ReviewSummary {
  const strengthened = items.filter((i) => i.direction === "strengthened").length;
  const weakened = items.filter((i) => i.direction === "weakened").length;
  const unchanged = items.filter((i) => i.direction === "unchanged").length;
  const total = items.length;

  let headline: string;
  if (total === 0) {
    headline = "还没有持仓——添加并生成投资逻辑后，这里会汇总它们过去 30 天的逻辑变化。";
  } else if (strengthened === 0 && weakened === 0) {
    headline = `过去 30 天，你的 ${total} 只持仓逻辑均无实质变化——没有新料，也是一种信息。`;
  } else {
    const parts: string[] = [];
    if (strengthened) parts.push(`${strengthened} 只逻辑增强`);
    if (weakened) parts.push(`${weakened} 只出现风险信号`);
    if (unchanged) parts.push(`${unchanged} 只无实质变化`);
    headline = `过去 30 天：${parts.join(" · ")}。`;
  }
  return { strengthened, weakened, unchanged, total, headline };
}
