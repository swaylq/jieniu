/**
 * 逻辑追踪器（P5-7）——ChatGPT 批评：公司页该像一份**持续更新的 investment memo**，
 * 把每个投资命题「验证到什么程度、最新证据、在增强还是削弱」显式列出，而不是静态维度清单。
 *
 * 纯规则、零 AI：由已有 ThesisSignal 的 direction × materiality 推导每个维度的
 * 当前验证状态（已验证/部分验证/待验证/未验证）+ 变化（复用 P5-2 逻辑影响 6 级）+ 最新证据。
 * 铁律：状态/变化一律 amber/灰（增强 amber、削弱 ink、无/未定 muted），不用红绿；数字来自 DB 不编。
 *
 * 2026-07-30 张楚寒第二轮：**「已验证」不能只看材料度**。原话——
 * 「『已验证』最好至少需要一条能够直接支持命题的一级至三级证据。
 *   只有研报观点或者AI推断，最多标为『部分验证』。」
 * 于是门槛从「材料度 ≥ 70」换成两条硬条件同时成立：
 *   ① 来源等级 ≤ 3（财报/公告/监管、管理层披露、行业量价与订单数据）
 *   ② 直接支持命题（`grade === "direct"`，即这条事实说的就是这家公司）
 * 材料度退化成同分裂票——它是 AI 打的分，本身就是「AI 推断」，不该独自决定「已验证」。
 */
import { MATERIAL_ALERT_THRESHOLD } from "./thesis-status";
import {
  STRONG_IMPACT_THRESHOLD,
  classifyLogicImpact,
  type LogicImpact,
} from "./logic-impact";
import { isHardSource, type SourceLevel } from "./evidence-source";

export type TrackStatus = "validated" | "partial" | "watching" | "untested";

/** amber 强/弱、muted——不用红绿。 */
export type StatusTone = "strong" | "soft" | "muted";

export type DimSignal = {
  direction: string; // bull | bear | neutral
  materiality: number;
  note: string;
  publishedAt?: Date | string | null;
  /** 证据来源等级 1–6（`evidence-source.ts`）。旧数据没有时按 4（媒体）保守处理。 */
  sourceLevel?: SourceLevel;
  /** direct = 说的就是这家公司；supporting = 同业/上游旁证。 */
  grade?: string;
};

export type DimTracking = {
  status: TrackStatus;
  statusLabel: string; // 已验证 / 部分验证 / 待验证 / 未验证
  statusTone: StatusTone;
  /** 为什么是这个状态——一句话，给用户看，也是自检。 */
  statusWhy: string;
  impact: LogicImpact; // 变化（增强/削弱/无实质…）
  latest: { note: string; publishedAt?: Date | string | null } | null;
  hitCount: number;
};

const STATUS_META: Record<TrackStatus, { label: string; tone: StatusTone }> = {
  validated: { label: "已验证", tone: "strong" },
  partial: { label: "部分验证", tone: "soft" },
  watching: { label: "待验证", tone: "muted" },
  untested: { label: "未验证", tone: "muted" },
};

function toTime(d?: Date | string | null): number {
  if (!d) return 0;
  const t = new Date(d).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** 旧行没有来源等级时按 4（媒体报道）处理——**保守方向**：宁可少标「已验证」。 */
function levelOf(s: DimSignal): SourceLevel {
  return s.sourceLevel ?? 4;
}

/**
 * 够格支撑「已验证」的证据：一到三级来源 + 直接支持命题 + 达到材料级。
 * 三条缺一不可——这正是张楚寒说的「只有研报观点或者AI推断，最多部分验证」。
 */
export function isValidatingEvidence(s: DimSignal): boolean {
  return (
    s.direction === "bull" &&
    s.materiality >= MATERIAL_ALERT_THRESHOLD &&
    isHardSource(levelOf(s)) &&
    s.grade === "direct"
  );
}

export function trackDimension(signals: DimSignal[]): DimTracking {
  const material = signals.filter(
    (s) => s.materiality >= MATERIAL_ALERT_THRESHOLD,
  );
  const bull = material.filter((s) => s.direction === "bull");
  const validating = signals.filter(isValidatingEvidence);

  let status: TrackStatus;
  let statusWhy: string;
  if (validating.length > 0) {
    status = "validated";
    statusWhy = `有 ${validating.length} 条直接支持该命题的一至三级证据`;
  } else if (bull.length > 0) {
    status = "partial";
    // 说清差在哪一条：是来源不够硬，还是不是关于这家公司的
    const soft = bull.filter((s) => !isHardSource(levelOf(s))).length;
    const indirect = bull.filter((s) => s.grade !== "direct").length;
    statusWhy =
      soft > 0 && indirect > 0
        ? "现有证据要么来源等级不足（媒体/研报），要么不是直接关于这家公司的"
        : soft > 0
          ? "现有证据来自媒体/研报，尚无一至三级硬证据"
          : "现有证据是旁证（同业/上游），尚无直接关于这家公司的事实";
  } else if (signals.length > 0) {
    status = "watching";
    statusWhy = "有动态触及该命题，但尚无偏兑现方向的材料级证据";
  } else {
    status = "untested";
    statusWhy = "近期没有够格的证据触及该命题";
  }

  // 变化：取材料度最高的一条信号的方向 × 材料度（P5-2）
  const top = [...signals].sort((a, b) => b.materiality - a.materiality)[0];
  const impact = classifyLogicImpact({
    direction: top?.direction ?? "neutral",
    materiality: top?.materiality ?? 0,
  });

  // 最新证据：publishedAt 最近的一条
  const latest =
    signals.length > 0
      ? [...signals].sort((a, b) => toTime(b.publishedAt) - toTime(a.publishedAt))[0]
      : null;

  return {
    status,
    statusLabel: STATUS_META[status].label,
    statusTone: STATUS_META[status].tone,
    statusWhy,
    impact,
    latest: latest ? { note: latest.note, publishedAt: latest.publishedAt } : null,
    hitCount: signals.length,
  };
}

/** 状态徽标类名：已验证 amber 实、部分验证 amber 淡、待/未验证 muted。不用红绿。 */
export function statusBadgeClass(tone: StatusTone): string {
  if (tone === "strong")
    return "rounded bg-brand/15 px-1.5 py-0.5 text-[11px] font-semibold text-brand";
  if (tone === "soft")
    return "rounded border border-brand/30 px-1.5 py-0.5 text-[11px] font-medium text-brand/90";
  return "rounded border border-line px-1.5 py-0.5 text-[11px] font-medium text-muted";
}

/** `STRONG_IMPACT_THRESHOLD` 仍被「变化」列复用，这里显式再导出一次，避免调用方绕道。 */
export { STRONG_IMPACT_THRESHOLD };
