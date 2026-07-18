/**
 * 「问解牛」上下文装配（P5-5）——把用户的四层 Memory（画像 / 持仓·观察 / 投资逻辑 / 近期动态 / 决策史）
 * 压成一段紧凑的中文上下文，喂给 AI，让回答是**针对这位用户**的、而不是泛泛而谈。
 *
 * 纯函数、零 AI、可测。省 token：各层都设上限截断，信号按材料度过滤，只带真正有用的记忆。
 * 铁律：只汇总 DB 里的事实，不编造；数字（成本/仓位/材料度）原样带出，由 AI 使用而非虚构。
 */
import { MATERIAL_ALERT_THRESHOLD } from "./thesis-status";

export type AskMemory = {
  profile: {
    style: string | null;
    riskLevel: string | null;
    summary: string | null;
  } | null;
  holdings: {
    entityId: string;
    name: string;
    ticker: string | null;
    status: string; // HOLDING | WATCH | CLOSED
    costBasis: number | null;
    weight: number | null;
    note: string | null;
  }[];
  theses: { name: string; summary: string }[];
  signals: {
    name: string;
    dimensionKey: string;
    direction: string; // bull | bear | neutral
    materiality: number;
    note: string;
  }[];
  decisions: { name: string; action: string; reason: string }[];
};

export type AskContext = {
  contextText: string;
  groundedHoldings: { entityId: string; name: string }[];
  groundedTheses: string[];
  hasMemory: boolean;
};

const MAX_HOLDINGS = 12;
const MAX_THESES = 8;
const MAX_SIGNALS = 8;
const MAX_DECISIONS = 5;

const STYLE_CN: Record<string, string> = {
  value: "价值",
  growth: "成长",
  trade: "交易",
};
const RISK_CN: Record<string, string> = {
  conservative: "保守",
  balanced: "均衡",
  aggressive: "激进",
};
const STATUS_CN: Record<string, string> = {
  HOLDING: "持仓",
  WATCH: "观察",
  CLOSED: "已清",
};

/** 信号方向 → 中文（中性罗列，非涨跌预测）。 */
function directionCn(direction: string): string {
  if (direction === "bull") return "偏兑现";
  if (direction === "bear") return "偏风险";
  return "方向不明";
}

export function buildAskContext(mem: AskMemory): AskContext {
  const holdings = mem.holdings.slice(0, MAX_HOLDINGS);
  const theses = mem.theses.slice(0, MAX_THESES);
  const signals = mem.signals
    .filter((s) => s.materiality >= MATERIAL_ALERT_THRESHOLD)
    .sort((a, b) => b.materiality - a.materiality)
    .slice(0, MAX_SIGNALS);
  const decisions = mem.decisions.slice(0, MAX_DECISIONS);

  const profileHas =
    !!mem.profile &&
    (!!mem.profile.style || !!mem.profile.riskLevel || !!mem.profile.summary);
  const hasMemory =
    profileHas || holdings.length > 0 || theses.length > 0;

  const parts: string[] = [];

  if (profileHas && mem.profile) {
    const p = mem.profile;
    const bits: string[] = [];
    if (p.style) bits.push(`风格 ${STYLE_CN[p.style] ?? p.style}`);
    if (p.riskLevel)
      bits.push(`风险偏好 ${RISK_CN[p.riskLevel] ?? p.riskLevel}`);
    if (p.summary) bits.push(`解牛归纳：${p.summary}`);
    parts.push(`【投资画像】${bits.join("；")}`);
  }

  if (holdings.length > 0) {
    const lines = holdings.map((h) => {
      const seg: string[] = [
        `${h.name}${h.ticker ? `(${h.ticker})` : ""}`,
        STATUS_CN[h.status] ?? h.status,
      ];
      if (h.costBasis != null) seg.push(`成本 ${h.costBasis}`);
      if (h.weight != null) seg.push(`仓位 ${h.weight}%`);
      if (h.note) seg.push(`备注：${h.note}`);
      return `- ${seg.join(" ")}`;
    });
    parts.push(`【持仓 / 观察】(${holdings.length})\n${lines.join("\n")}`);
  }

  if (theses.length > 0) {
    const lines = theses.map((t) => `- ${t.name}：${t.summary}`);
    parts.push(`【投资逻辑(thesis)】\n${lines.join("\n")}`);
  }

  if (signals.length > 0) {
    const lines = signals.map(
      (s) =>
        `- ${s.name} · ${s.dimensionKey}：${directionCn(s.direction)}(材料度 ${s.materiality}) ${s.note}`,
    );
    parts.push(`【近期触及你逻辑的动态】\n${lines.join("\n")}`);
  }

  if (decisions.length > 0) {
    const lines = decisions.map((d) => `- ${d.name} ${d.action}：${d.reason}`);
    parts.push(`【你近期的决策记录】\n${lines.join("\n")}`);
  }

  const contextText = hasMemory
    ? parts.join("\n\n")
    : "（这位用户还没有记录持仓、观察或投资逻辑。）";

  return {
    contextText,
    groundedHoldings: holdings.map((h) => ({
      entityId: h.entityId,
      name: h.name,
    })),
    groundedTheses: theses.map((t) => t.name),
    hasMemory,
  };
}
