export function dirLabel(d: string): string {
  return d === "bull" ? "偏兑现" : d === "bear" ? "偏风险" : "中性";
}

export type LensSignal = {
  dimensionKey: string;
  direction: string;
  materiality: number;
};

/** 单个实体视角下"这条资讯动没动你的逻辑"的聚合：取最材料的信号定调，统计触及维度数。 */
export function summarizeEntityLens(signals: LensSignal[]): {
  topDimension: string;
  topDirection: string;
  dimCount: number;
  headline: string;
} {
  if (signals.length === 0) {
    return {
      topDimension: "",
      topDirection: "neutral",
      dimCount: 0,
      headline: "未触及你监控的投资逻辑。",
    };
  }
  const top = signals.reduce((a, b) => (b.materiality > a.materiality ? b : a));
  const dimCount = new Set(signals.map((s) => s.dimensionKey)).size;
  return {
    topDimension: top.dimensionKey,
    topDirection: top.direction,
    dimCount,
    headline: `触及 ${dimCount} 个维度，最受影响：${top.dimensionKey}（${dirLabel(top.direction)}）`,
  };
}

/** 材料级提醒阈值：材料度 ≥ 此值才够格推送/进通知中心（没料不打扰）。 */
export const MATERIAL_ALERT_THRESHOLD = 40;

/** 这条信号够不够"材料级"——只有够材料的 thesis 变化才提醒，其余静音。 */
export function isThesisAlert(materiality: number): boolean {
  return materiality >= MATERIAL_ALERT_THRESHOLD;
}

export type SignalLike = {
  dimensionKey: string;
  direction: string;
  materiality: number;
  note: string;
};

export type ThesisStatus = {
  active: boolean;
  count: number;
  top: SignalLike | null;
  headline: string;
};

/** 投资逻辑近期状态摘要：有信号→点出最受关注的维度；无信号→"静音中"（没料不打扰）。中性、非涨跌预测。 */
export function thesisActivityStatus(signals: SignalLike[]): ThesisStatus {
  if (signals.length === 0) {
    return {
      active: false,
      count: 0,
      top: null,
      headline: "近期无实质动态触及投资逻辑，静音中。",
    };
  }
  const top = signals.reduce((a, b) => (b.materiality > a.materiality ? b : a));
  return {
    active: true,
    count: signals.length,
    top,
    headline: `近期 ${signals.length} 条动态触及投资逻辑，最受关注：${top.dimensionKey}（${dirLabel(top.direction)}）`,
  };
}

/** 维度按"近期活跃度"排序：有信号且材料度高的维度浮到前面；无信号维度保持原相对次序。 */
export function sortDimensionsByActivity<T extends { key: string }>(
  dims: T[],
  signals: { dimensionKey: string; materiality: number }[],
): T[] {
  const maxByDim = new Map<string, number>();
  for (const s of signals) {
    maxByDim.set(
      s.dimensionKey,
      Math.max(maxByDim.get(s.dimensionKey) ?? 0, s.materiality),
    );
  }
  return dims
    .map((d, i) => ({ d, i }))
    .sort((x, y) => {
      const sx = maxByDim.has(x.d.key) ? maxByDim.get(x.d.key)! : -1;
      const sy = maxByDim.has(y.d.key) ? maxByDim.get(y.d.key)! : -1;
      return sy !== sx ? sy - sx : x.i - y.i;
    })
    .map((o) => o.d);
}
