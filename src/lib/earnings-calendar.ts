/**
 * 催化日历 · 财报季节点（P5-9）——ChatGPT 建议加「接下来 7 天」催化日历；铁律「数据先做可确定的、不编」。
 *
 * A 股定期报告的**法定披露截止日是固定规则**（确定性、可算、非臆测）：
 *   - 年报 & 一季报：次年 4 月 30 日前
 *   - 半年报：8 月 31 日前
 *   - 三季报：10 月 31 日前
 * 这是全市场统一的**最晚披露日**（个股常提前，确切预约日需交易所结构化日程源、暂未接入——不编）。
 * 纯函数、零 AI、可测。
 */
export type DisclosureNode = {
  key: string;
  label: string;
  period: string; // 覆盖的报告
  deadline: Date; // 法定最晚披露日
  daysUntil: number; // 距今天数（向上取整）
};

/** 接下来 N 天内算「临近」，UI 高亮。 */
export const NEAR_DAYS = 7;

const NODE_DEFS = [
  { key: "annual_q1", label: "年报 · 一季报", month: 4, day: 30, period: "上年度年报 + 当年一季报" },
  { key: "semi", label: "半年报", month: 8, day: 31, period: "半年度报告" },
  { key: "q3", label: "三季报", month: 10, day: 31, period: "第三季度报告" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

export function upcomingDisclosureNodes(now: Date, count = 2): DisclosureNode[] {
  const y = now.getFullYear();
  const cands: DisclosureNode[] = [];
  for (const yr of [y, y + 1]) {
    for (const d of NODE_DEFS) {
      const deadline = new Date(yr, d.month - 1, d.day, 23, 59, 59);
      cands.push({
        key: `${d.key}_${yr}`,
        label: d.label,
        period: d.period,
        deadline,
        daysUntil: Math.ceil((deadline.getTime() - now.getTime()) / DAY_MS),
      });
    }
  }
  return cands
    .filter((n) => n.deadline.getTime() >= now.getTime())
    .sort((a, b) => a.deadline.getTime() - b.deadline.getTime())
    .slice(0, count);
}
