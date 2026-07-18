/**
 * 逻辑追踪器（P5-7）——ChatGPT 批评：公司页该像一份**持续更新的 investment memo**，
 * 把每个投资命题「验证到什么程度、最新证据、在增强还是削弱」显式列出，而不是静态维度清单。
 *
 * 纯规则、零 AI：由已有 ThesisSignal 的 direction × materiality 推导每个维度的
 * 当前验证状态（已验证/部分验证/待验证/未验证）+ 变化（复用 P5-2 逻辑影响 6 级）+ 最新证据。
 * 铁律：状态/变化一律 amber/灰（增强 amber、削弱 ink、无/未定 muted），不用红绿；数字来自 DB 不编。
 */
import { MATERIAL_ALERT_THRESHOLD } from "./thesis-status";
import {
  STRONG_IMPACT_THRESHOLD,
  classifyLogicImpact,
  type LogicImpact,
} from "./logic-impact";

export type TrackStatus = "validated" | "partial" | "watching" | "untested";

/** amber 强/弱、muted——不用红绿。 */
export type StatusTone = "strong" | "soft" | "muted";

export type DimSignal = {
  direction: string; // bull | bear | neutral
  materiality: number;
  note: string;
  publishedAt?: Date | string | null;
};

export type DimTracking = {
  status: TrackStatus;
  statusLabel: string; // 已验证 / 部分验证 / 待验证 / 未验证
  statusTone: StatusTone;
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

export function trackDimension(signals: DimSignal[]): DimTracking {
  const material = signals.filter(
    (s) => s.materiality >= MATERIAL_ALERT_THRESHOLD,
  );
  const bull = material.filter((s) => s.direction === "bull");
  const strongBull = bull.some((s) => s.materiality >= STRONG_IMPACT_THRESHOLD);

  let status: TrackStatus;
  if (bull.length > 0 && strongBull) status = "validated";
  else if (bull.length > 0) status = "partial";
  else if (signals.length > 0) status = "watching"; // 有关注/信号但多头逻辑尚未获材料级验证
  else status = "untested";

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
