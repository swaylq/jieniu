/**
 * 事件时间线复盘（P5-11）——ChatGPT：公司页该有时间线「发生了什么 / 后来是否验证 / 你当时的判断」，越用越聪明。
 *
 * 用已有数据、纯规则、零 AI：材料级 ThesisSignal = 「发生了什么（触及逻辑）」；
 * 「后来是否验证」= 看同维度**更晚**的材料信号是否同向（印证）/反向（反转）/无（尚待）；
 * 用户 Decision = 「你当时的判断」，与信号按时间倒序交织。
 * 诚实：股价反应 / 当时市场预期的**定量**复盘需行情数据（P4-10），不做、不编。配色 amber/灰不涉红绿。
 */
import { MATERIAL_ALERT_THRESHOLD } from "./thesis-status";

export type FollowUp = "confirmed" | "reversed" | "pending";

export const FOLLOWUP_LABEL: Record<FollowUp, string> = {
  confirmed: "后续得到印证",
  reversed: "后续被反转",
  pending: "尚待后续验证",
};

/** confirmed=amber(印证)、reversed=ink(反转)、pending=muted。不用红绿。 */
export function followUpTone(f: FollowUp): "accent" | "ink" | "muted" {
  if (f === "confirmed") return "accent";
  if (f === "reversed") return "ink";
  return "muted";
}

export type TLSignal = {
  dimensionKey: string;
  direction: string; // bull | bear | neutral
  materiality: number;
  note: string;
  newsTitle?: string | null;
  newsId?: string | null;
  publishedAt: Date | string;
};

export type TLDecision = {
  action: string;
  reason: string;
  createdAt: Date | string;
};

export type TimelineItem =
  | {
      kind: "signal";
      at: number;
      dimensionKey: string;
      direction: string;
      materiality: number;
      note: string;
      newsTitle?: string | null;
      newsId?: string | null;
      followUp: FollowUp;
    }
  | { kind: "decision"; at: number; action: string; reason: string };

const t = (d: Date | string): number => new Date(d).getTime();

function opposite(a: string, b: string): boolean {
  return (
    (a === "bull" && b === "bear") || (a === "bear" && b === "bull")
  );
}

/** 判断某条信号之后、同维度的更晚材料信号是否印证/反转。 */
function computeFollowUp(signal: TLSignal, all: TLSignal[]): FollowUp {
  const later = all.filter(
    (x) =>
      x.dimensionKey === signal.dimensionKey &&
      t(x.publishedAt) > t(signal.publishedAt) &&
      x.materiality >= MATERIAL_ALERT_THRESHOLD,
  );
  if (later.length === 0) return "pending";
  if (later.some((x) => x.direction === signal.direction && x.direction !== "neutral"))
    return "confirmed";
  if (later.some((x) => opposite(x.direction, signal.direction))) return "reversed";
  return "pending";
}

export function buildEventTimeline(
  signals: TLSignal[],
  decisions: TLDecision[],
): TimelineItem[] {
  const material = signals.filter(
    (s) => s.materiality >= MATERIAL_ALERT_THRESHOLD,
  );
  const sigItems: TimelineItem[] = material.map((s) => ({
    kind: "signal",
    at: t(s.publishedAt),
    dimensionKey: s.dimensionKey,
    direction: s.direction,
    materiality: s.materiality,
    note: s.note,
    newsTitle: s.newsTitle,
    newsId: s.newsId,
    followUp: computeFollowUp(s, material),
  }));
  const decItems: TimelineItem[] = decisions.map((d) => ({
    kind: "decision",
    at: t(d.createdAt),
    action: d.action,
    reason: d.reason,
  }));
  return [...sigItems, ...decItems].sort((a, b) => b.at - a.at);
}
