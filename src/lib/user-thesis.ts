// 用户自有投资逻辑（S1）的纯逻辑。共享 Thesis 是 AI 基础框架；用户采纳后拥有
// 维度选择/重点/敏感度/静音，监控在**读取层**按此个性化（不改共享分类管线，省 token）。

import type { ThesisDimension } from "./thesis";

export type Sensitivity = "low" | "normal" | "high";

export type UserDimension = {
  key: string;
  watch: string;
  bull: string;
  bear: string;
  priority: boolean; // 标为重点（优先排序/展示）
  sensitivity: Sensitivity; // 触发敏感度 → 材料度阈值
  muted: boolean; // 不监控该维度
  source: "base" | "user"; // base=从共享框架采纳；user=自行新增
};

export type UserThesisData = {
  reason: string | null; // 一句话：我为什么持有/关注
  horizon: string | null; // long | swing
  dimensions: UserDimension[];
};

// 敏感度 → 材料度阈值：high 更易触发（低阈值），low 更克制（高阈值）。
export const SENSITIVITY_THRESHOLD: Record<Sensitivity, number> = {
  high: 40,
  normal: 60,
  low: 80,
};

const SENSITIVITIES: Sensitivity[] = ["low", "normal", "high"];

function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function asBool(v: unknown): boolean {
  return v === true;
}
function asSensitivity(v: unknown): Sensitivity {
  return SENSITIVITIES.includes(v as Sensitivity)
    ? (v as Sensitivity)
    : "normal";
}

/** 从 base thesis 维度生成初始 user 维度：全部采纳、normal 敏感度、非重点、未静音、source=base。 */
export function adoptDimensions(base: ThesisDimension[]): UserDimension[] {
  return base
    .filter((d) => d.key)
    .map((d): UserDimension => ({
      key: d.key,
      watch: d.watch,
      bull: d.bull,
      bear: d.bear,
      priority: false,
      sensitivity: "normal",
      muted: false,
      source: "base",
    }));
}

/** 未静音的维度（实际在监控的）。 */
export function activeDimensions(dims: UserDimension[]): UserDimension[] {
  return dims.filter((d) => !d.muted);
}

/**
 * 用用户 thesis 个性化 signals：
 * - 只保留属于用户「活跃维度」（存在且未静音）的信号；
 * - 每维度按其 sensitivity 阈值滤材料度；
 * - 重点维度优先，其次按材料度降序。
 */
export function personalizeSignals<
  T extends { dimensionKey: string; materiality: number },
>(dims: UserDimension[], signals: T[]): T[] {
  const byKey = new Map(dims.map((d) => [d.key, d]));
  const kept = signals.filter((s) => {
    const d = byKey.get(s.dimensionKey);
    if (!d || d.muted) return false;
    return s.materiality >= SENSITIVITY_THRESHOLD[d.sensitivity];
  });
  return kept.sort((a, b) => {
    const pa = byKey.get(a.dimensionKey)!.priority ? 1 : 0;
    const pb = byKey.get(b.dimensionKey)!.priority ? 1 : 0;
    if (pa !== pb) return pb - pa; // 重点在前
    return b.materiality - a.materiality;
  });
}

/**
 * 激活回填汇总（S2 onboarding「aha」）：给定用户维度与一段时间的信号，算出
 * - touchedCount：触及你活跃维度的动态数（不论阈值）；
 * - wouldAlertCount：其中达到你敏感度阈值、会触发提醒的数；
 * - samples：会提醒的前 3 条（已按重点/材料度排序）。
 */
export function activationBackfill<
  T extends { dimensionKey: string; materiality: number },
>(
  dims: UserDimension[],
  signals: T[],
): { touchedCount: number; wouldAlertCount: number; samples: T[] } {
  const active = new Set(activeDimensions(dims).map((d) => d.key));
  const touchedCount = signals.filter((s) => active.has(s.dimensionKey)).length;
  const wouldAlert = personalizeSignals(dims, signals);
  return {
    touchedCount,
    wouldAlertCount: wouldAlert.length,
    samples: wouldAlert.slice(0, 3),
  };
}

/** 某维度在用户 thesis 中的状态（S3 提醒个性化）；不在其中→null（表示按 base 处理、不过滤）。 */
export function userDimensionStatus(
  dims: UserDimension[],
  key: string,
): { muted: boolean; priority: boolean } | null {
  const d = dims.find((x) => x.key === key);
  return d ? { muted: d.muted, priority: d.priority } : null;
}

/** 规整客户端传入的维度：补默认、去空 key、clamp 敏感度；source 缺省为 user。 */
export function normalizeUserDimensions(input: unknown[]): UserDimension[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((raw): UserDimension | null => {
      const o = (raw ?? {}) as Record<string, unknown>;
      const key = asStr(o.key).trim();
      if (!key) return null;
      return {
        key,
        watch: asStr(o.watch),
        bull: asStr(o.bull),
        bear: asStr(o.bear),
        priority: asBool(o.priority),
        sensitivity: asSensitivity(o.sensitivity),
        muted: asBool(o.muted),
        source: o.source === "base" ? "base" : "user",
      };
    })
    .filter((d): d is UserDimension => d !== null);
}
