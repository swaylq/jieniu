// 分层（Phase 3 P3-7）：曾分 普通/Plus 两档；**会员限制已移除**——全部功能对所有人开放。
// 类型 / PLAN_META / STANDARD_FEATURES 等保留，供停用的 /plus 页与 billing 兼容，不再作权限门槛。
export type PlanTier = "STANDARD" | "PLUS";

export type PlanFeature =
  | "watchlist-denoise"
  | "thesis-watch"
  | "material-alerts"
  | "ecosystem"
  | "market-ai";

/** 普通会员(¥88/月)已含的能力——解牛的核心监控产品。 */
export const STANDARD_FEATURES: PlanFeature[] = [
  "watchlist-denoise",
  "thesis-watch",
  "material-alerts",
  "ecosystem",
];
/** Plus 独占：加"盯行情"（数值级，后续基建）。 */
export const PLUS_ONLY_FEATURES: PlanFeature[] = ["market-ai"];

export function planFeatures(_plan?: PlanTier): PlanFeature[] {
  // 会员限制已移除：无论档位，一律拥有全部功能。
  return [...STANDARD_FEATURES, ...PLUS_ONLY_FEATURES];
}

export function hasFeature(plan: PlanTier, f: PlanFeature): boolean {
  return planFeatures(plan).includes(f);
}

/** 把库里/会话里的原始值收敛成合法档位；未知或空一律普通会员。 */
export function normalizePlan(raw: string | null | undefined): PlanTier {
  return raw === "PLUS" ? "PLUS" : "STANDARD";
}

export const FEATURE_LABEL: Record<PlanFeature, string> = {
  "watchlist-denoise": "自选股降噪：只看你的票 + 行业 + 竞品",
  "thesis-watch": "Thesis Watch：每票 AI 投资逻辑框架 + 命中监控",
  "material-alerts": "材料级异动提醒：动了逻辑才提醒，没料不打扰",
  ecosystem: "行业 + 竞品覆盖图谱",
  "market-ai": "AI 行情分析：K 线形态 / 资金流向 / 量价走势的客观归纳",
};

export const PLAN_META: Record<
  PlanTier,
  { name: string; price: string; tagline: string }
> = {
  STANDARD: {
    name: "普通会员",
    price: "¥88 / 月",
    tagline: "盯资讯——你自选股的投资逻辑监控",
  },
  PLUS: {
    name: "Plus 会员",
    price: "¥188 / 月",
    tagline: "盯行情——在普通版之上再加 AI 行情分析",
  },
};
