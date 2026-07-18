// 投资晨报（首页个人工作台）纯逻辑。张楚寒反馈 2026-07-13：一点进首页应是「个人工作台」，
// 不是全市场资讯流。这里把持仓逻辑变化汇成晨报的问候语 + 4 张状态卡计数。
//
// 铁律：状态全 amber/coral(注意)/灰，非红绿价格；不涉及任何行情数值（缺行情不假装）。

import type { ChangeDirection } from "./portfolio-change";

/** 按小时选问候语（本地时间；服务端渲染用 new Date().getHours()）。 */
export function greetingByHour(hour: number): string {
  if (hour < 5) return "夜深了";
  if (hour < 12) return "早上好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

export type BriefingStats = {
  /** 需要复核：逻辑削弱/偏风险的持仓数。 */
  review: number;
  /** 逻辑增强：偏兑现的持仓数。 */
  strengthened: number;
  /** 今日静音：无实质动态的持仓数。 */
  muted: number;
  /** 值得注意 = 复核 + 增强（有实质变化的持仓数）。 */
  noticeable: number;
};

/** 从「今天你的组合变了什么」的每票方向汇总 4 卡计数。 */
export function briefingStats(items: { direction: ChangeDirection }[]): BriefingStats {
  const review = items.filter((i) => i.direction === "weakened").length;
  const strengthened = items.filter((i) => i.direction === "strengthened").length;
  const muted = items.filter((i) => i.direction === "unchanged").length;
  return { review, strengthened, muted, noticeable: review + strengthened };
}

/**
 * 晨报主标题（问候语之后那句）。有实质变化 → 「今天有 N 件事值得你注意。」；
 * 全静 → 平静文案（宁静也是信号，守「宁少毋滥」）。
 */
export function briefingHeadline(noticeable: number): string {
  if (noticeable <= 0) {
    return "你关注的投资逻辑今天都很平静，没有需要复核的变化。";
  }
  return `今天有 ${noticeable} 件事值得你注意。`;
}

/**
 * 晨报副行：用真实计数说明「监控了多少、与你相关多少」。缺持仓时给引导语。
 * relatedCount = 近 7 天触及你持仓监控维度的材料动态条数。
 */
export function briefingSubline(watchCount: number, relatedCount: number): string {
  if (watchCount === 0) {
    return "标记你的持仓与观察，解牛每天只回答一件事：今天的消息有没有动摇你的投资逻辑。";
  }
  if (relatedCount === 0) {
    return `盯着你的 ${watchCount} 个自选标的 · 近 7 天没有触及投资逻辑的实质动态。`;
  }
  return `盯着你的 ${watchCount} 个自选标的 · 近 7 天为你筛出 ${relatedCount} 条触及投资逻辑的动态。`;
}
