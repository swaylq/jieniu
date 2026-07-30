/**
 * 券商研报（作为**事件**）的共享定义。
 *
 * 研报在解牛里记录的是「哪家机构在哪天发了一篇什么主题的研报」这一事件，
 * **不含**它的评级与目标价（源头 `ingest/sources/eastmoney-report.ts` 就已剔除，
 * 标题含评级/目标价语言的整条丢弃）。这一点决定了它和「机构一致预期」卡的关系：
 * 那张卡上的评级分布是**东财汇总的第三方口径**，跟这里的研报清单不是一一对应的
 * ——不能说「这 11 篇买入研报在这儿」，只能说「这家公司的机构研报在这儿」。
 *
 * eventType 用字符串标记而不是新建源过滤：`eastmoney-report` 是主力（6.7k 条），
 * 但快讯/资讯/公告源里也有被判成研报体裁的条目（合计 ~200 条），按 eventType 取
 * 才能把它们一并收进来。
 */

export const REPORT_EVENT_TYPE = "研报";

/** 个股页「研报」tab 的地址（研报同时绑 COMPANY 与 STOCK 两侧，公司页/股票页都能落地）。 */
export function reportsTabHref(entityId: string): string {
  return `/entity/${entityId}?tab=report`;
}
