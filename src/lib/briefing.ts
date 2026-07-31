// 投资晨报（首页个人工作台）纯逻辑。张楚寒反馈 2026-07-13：一点进首页应是「个人工作台」，
// 不是全市场资讯流。这里把持仓逻辑变化汇成晨报的问候语 + 4 张状态卡计数。
//
// 铁律：状态全 amber/coral(注意)/灰，非红绿价格；不涉及任何行情数值（缺行情不假装）。

import type { PortfolioChangeItem } from "./portfolio-change";

/** 按小时选问候语（本地时间；服务端渲染用 new Date().getHours()）。 */
export function greetingByHour(hour: number): string {
  if (hour < 5) return "夜深了";
  if (hour < 12) return "早上好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

export type BriefingStats = {
  /** 需要复核：**有偏风险动态**的标的数。 */
  review: number;
  /** 逻辑增强：有偏兑现动态的标的数。 */
  strengthened: number;
  /** 今日静音：一条材料级动态都没有的标的数。 */
  muted: number;
  /** 值得注意：有任何材料级动态的标的数（= 总数 − 静音）。 */
  noticeable: number;
};

/**
 * 从「今天你的组合变了什么」汇总 4 卡计数。
 *
 * 2026-07-31 改判据：原来三个数按**净方向**划分（weakened/strengthened/unchanged），
 * 于是 6 条 bull + 3 条 bear 的标的被多数票判成「增强」，那 3 条风险就从「需要复核」里消失了
 * ——实测全库 18 只覆盖股中 8 只带 bear，而按净方向只数得出 1 只，这就是复核卡长期为 0 的真因
 * （不是 AI 不出 bear：输入偏风险体裁 12.8%、输出 bear 13.9%，供给与产出是对得上的）。
 *
 * 现在三个数各问各的问题，允许重叠：有 bear 就该复核，有 bull 就是增强，两者皆无才叫静音。
 */
export function briefingStats(
  items: Pick<PortfolioChangeItem, "bullCount" | "bearCount" | "materialCount">[],
): BriefingStats {
  const review = items.filter((i) => i.bearCount > 0).length;
  const strengthened = items.filter((i) => i.bullCount > 0).length;
  const muted = items.filter((i) => i.materialCount === 0).length;
  return { review, strengthened, muted, noticeable: items.length - muted };
}

/**
 * 晨报主标题（问候语之后那句）。有实质变化 → 「今天有 N 件事值得你注意。」；
 * 全静 → 平静文案（宁静也是信号，守「宁少毋滥」）；
 * 一只自选都没有 → 不许说「都很平静」，那是在给一份没做过的检查下结论。
 */
export function briefingHeadline(noticeable: number, watchCount = 1): string {
  if (watchCount <= 0) {
    return "还没有自选标的——加上你在意的股票，解牛每天替你盯它的投资逻辑。";
  }
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
