/**
 * 「这次财报会验证你投资逻辑的哪几条」——解牛版财报前瞻的差异化模块。
 *
 * 富途的财报站围绕**市场预期**组织（一致预期 → 大行分歧 → 期权隐含波动）；解牛的锚是
 * 用户自己的 thesis。同一场财报，这里回答的问题不是「市场预期多少」，而是
 * **「它能验证/证伪你写下的哪几条」**——这是富途结构上给不出的东西（它没有 thesis）。
 *
 * 判定用**纯关键词**而不是 AI：
 *  ① 确定性、可测、零成本，不受生产环境 AI 提供商可用性影响（有过 AI 全线静默失效的事故）；
 *  ② 这一步只做「财报答不答得了这个问题」的粗筛，不需要语义推理；
 *  ③ 命中的词会在界面上标出来，用户能自己判断筛得对不对——不做黑箱。
 * 一条都没命中就返回空，不硬凑「你的逻辑都能被验证」。
 */

/** 财报能直接给出数据的口径词。刻意收窄——宁可漏，不可把政策/人事这类硬塞进来。 */
const FINANCIAL_TERMS = [
  "营收", "收入", "销售额",
  "净利", "利润", "盈利", "亏损", "扣非",
  "毛利率", "毛利", "净利率", "利润率",
  "成本", "费用", "研发投入",
  "现金流", "回款", "应收",
  "存货", "库存",
  "产能", "产量", "出货", "销量", "交付", "在手订单", "订单",
  "市占", "份额",
  "单价", "ASP", "均价",
  "同比", "环比", "增速",
  "资本开支", "折旧", "减值", "商誉",
  "负债率", "分红", "派息",
  "毛利润", "营业利润",
];

export type CheckableDimension = {
  key: string;
  watch: string;
  bull?: string;
  bear?: string;
  /** 命中的财务口径词（去重、按出现顺序）。 */
  matched: string[];
  priority?: string;
};

type RawDim = {
  key?: unknown;
  watch?: unknown;
  bull?: unknown;
  bear?: unknown;
  muted?: unknown;
  priority?: unknown;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * 从 `Thesis.dimensions` / `UserThesis.dimensions`（Prisma JSON）里挑出财报可验证的维度。
 * 已静音的维度直接跳过；用户标了 `priority: "high"` 的排前面。
 */
export function earningsCheckable(
  dimensions: unknown,
  limit?: number,
): CheckableDimension[] {
  if (!Array.isArray(dimensions)) return [];

  const out: CheckableDimension[] = [];
  for (const item of dimensions) {
    if (!item || typeof item !== "object") continue;
    const d = item as RawDim;
    if (d.muted === true) continue;

    const key = str(d.key).trim();
    const watch = str(d.watch).trim();
    if (!key || !watch) continue;

    const bull = str(d.bull).trim();
    const bear = str(d.bear).trim();
    const haystack = `${watch}\n${bull}\n${bear}`;

    const matched: string[] = [];
    for (const t of FINANCIAL_TERMS) {
      if (haystack.includes(t) && !matched.includes(t)) matched.push(t);
    }
    if (matched.length === 0) continue;

    out.push({
      key,
      watch,
      bull: bull || undefined,
      bear: bear || undefined,
      matched,
      priority: str(d.priority) || undefined,
    });
  }

  // 高优先级在前；同级按命中词数（越多说明越贴财报口径）。
  out.sort((a, b) => {
    const pa = a.priority === "high" ? 0 : 1;
    const pb = b.priority === "high" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return b.matched.length - a.matched.length;
  });

  return typeof limit === "number" ? out.slice(0, limit) : out;
}
