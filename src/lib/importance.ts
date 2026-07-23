import type { SourceTier } from "../../generated/prisma";

export type ImportanceInput = {
  tier: SourceTier;
  eventType?: string | null;
};

/** 事件类型关键词 → 权重（取命中的最高一档）。 */
const EVENT_WEIGHTS: Record<string, number> = {
  停牌: 45,
  处罚: 45,
  并购: 45,
  重组: 45,
  重整: 45,
  控制权: 45,
  要约收购: 45,
  破产: 45,
  退市: 45,
  立案: 45,
  财报: 40,
  业绩预告: 40,
  重大合同: 40,
  监管: 40,
  业绩快报: 35,
  复牌: 30,
  中标: 30,
  问询: 30,
  高管变动: 30,
  权益变动: 30,
  举牌: 30,
  增持: 25,
  减持: 25,
  回购: 25,
  解禁: 25,
  诉讼: 25,
  仲裁: 25,
  分红: 20,
  股权激励: 20,
  // 券商研报：是「有机构在关注/跟踪这家公司」的背景信息，不是事件本身，也不该进提醒。
  // 15 分 → MEDIA 级研报 importance=45，排得比纯基线媒体靠前，但仍低于重磅线 55。
  研报: 15,
};

const TIER_BONUS: Record<SourceTier, number> = {
  PRIMARY: 25,
  MEDIA: 10,
  DERIVED: 0,
};

/** 「重磅/重大动态」的重要度阈值（importance ≥ 此值 即视为重磅）。 */
export const IMPORTANT_THRESHOLD = 55;

/**
 * 「按重要性优先排序」的流必须带的时间窗（天）。
 *
 * 一年回填之前，库里只有约 3 周数据，`orderBy: [importance desc, publishedAt desc]`
 * **隐含**了「近期」这个约束。回填之后隐含约束消失：一条一年前的停牌(90 分)会永远
 * 压在首页「重大动态」第一条，自选流同理。把窗口显式写出来，恢复回填前的行为。
 *
 * 只约束「重要性优先」的流；按时间倒序的流（个股页资讯/公告、大事记）不受此限。
 */
export const SURFACING_WINDOW_DAYS = 30;

/** 重要性优先流的时间窗起点。 */
export function surfacingSince(now: Date): Date {
  return new Date(now.getTime() - SURFACING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

const BASELINE = 20;

function bestEvent(text?: string | null): [string, number] | null {
  if (!text) return null;
  let best: [string, number] | null = null;
  for (const [kw, w] of Object.entries(EVENT_WEIGHTS)) {
    if (text.includes(kw) && (best === null || w > best[1])) best = [kw, w];
  }
  return best;
}

export function eventScore(eventType?: string | null): number {
  return bestEvent(eventType)?.[1] ?? 0;
}

/** 从文本中识别出最重要的事件类型关键词（无命中则 null）。 */
export function detectEventType(text?: string | null): string | null {
  return bestEvent(text)?.[0] ?? null;
}

/** 0–100 的重要性分：基线 + 事件类型 + 来源等级。 */
export function scoreImportance(input: ImportanceInput): number {
  const score = BASELINE + eventScore(input.eventType) + TIER_BONUS[input.tier];
  return Math.max(0, Math.min(100, score));
}
