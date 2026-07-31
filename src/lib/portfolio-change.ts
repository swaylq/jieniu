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

/** 自选状态：真金白银的持仓 vs 只是盯着的观察。展示与排序用，不改判定逻辑。 */
export type WatchStatus = "HOLDING" | "WATCH";

export type PortfolioChangeItem = {
  entityId: string;
  name: string;
  direction: ChangeDirection;
  topDimension: string;
  topNote: string;
  /** 最材料的那条**偏风险**动态——净增强的标的也可能有，别让它被多数票埋掉。 */
  topBearNote: string;
  materialCount: number;
  signalCount: number;
  /** 材料级 bull / bear 各几条。方向只有一个，条数两侧都要留。 */
  bullCount: number;
  bearCount: number;
  status?: WatchStatus;
};

/** 一支自选近期信号 → 逻辑增强/削弱/未变。仅材料级(≥阈值)信号才算「变」——宁少毋滥。 */
export function rollUpHoldingChange(
  entityId: string,
  name: string,
  signals: ChangeSignal[],
  status?: WatchStatus,
): PortfolioChangeItem {
  const material = signals.filter((s) => s.materiality >= MATERIAL_ALERT_THRESHOLD);
  if (material.length === 0) {
    return {
      entityId,
      name,
      direction: "unchanged",
      topDimension: "",
      topNote: "",
      topBearNote: "",
      materialCount: 0,
      signalCount: signals.length,
      bullCount: 0,
      bearCount: 0,
      status,
    };
  }
  const top = material.reduce((a, b) => (b.materiality > a.materiality ? b : a));
  const bulls = material.filter((s) => s.direction === "bull");
  const bears = material.filter((s) => s.direction === "bear");
  const bull = bulls.length;
  const bear = bears.length;
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
  const topBear = bears.length
    ? bears.reduce((a, b) => (b.materiality > a.materiality ? b : a))
    : null;
  return {
    entityId,
    name,
    direction,
    topDimension: top.dimensionKey,
    topNote: top.note,
    topBearNote: topBear?.note ?? "",
    materialCount: material.length,
    signalCount: signals.length,
    bullCount: bull,
    bearCount: bear,
    status,
  };
}

/** 切分：有变化(增强/削弱)在前，未变归静音。同为有变化时，持仓排在观察前面。 */
export function partitionPortfolioChange(items: PortfolioChangeItem[]): {
  changed: PortfolioChangeItem[];
  muted: PortfolioChangeItem[];
} {
  const rank = (i: PortfolioChangeItem) => (i.status === "WATCH" ? 1 : 0);
  const changed = items
    .filter((i) => i.direction !== "unchanged")
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        b.materialCount - a.materialCount ||
        b.signalCount - a.signalCount,
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

/**
 * 周报/月报汇总（P5-10）：把一组自选的变化数成「X 增强 · Y 风险 · Z 无变化」一句话。纯规则、非涨跌预测。
 * 「风险信号」按**有没有 bear 条数**数，而不是按净方向——净增强的标的照样可能带风险动态，
 * 跟首页「需要复核」同一把尺子（三个数因此可以有重叠，不是划分）。
 */
export function summarizeReview(items: PortfolioChangeItem[]): ReviewSummary {
  const strengthened = items.filter((i) => i.direction === "strengthened").length;
  const weakened = items.filter(
    (i) => i.bearCount > 0 || i.direction === "weakened",
  ).length;
  const unchanged = items.filter((i) => i.direction === "unchanged").length;
  const total = items.length;

  let headline: string;
  if (total === 0) {
    headline = "还没有自选标的——加上你在意的股票并生成投资逻辑后，这里会汇总它们过去 30 天的逻辑变化。";
  } else if (strengthened === 0 && weakened === 0) {
    headline = `过去 30 天，你的 ${total} 只自选逻辑均无实质变化——没有新料，也是一种信息。`;
  } else {
    const parts: string[] = [];
    if (strengthened) parts.push(`${strengthened} 只逻辑增强`);
    if (weakened) parts.push(`${weakened} 只出现风险信号`);
    if (unchanged) parts.push(`${unchanged} 只无实质变化`);
    headline = `过去 30 天：${parts.join(" · ")}。`;
  }
  return { strengthened, weakened, unchanged, total, headline };
}
