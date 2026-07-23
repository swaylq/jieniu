/**
 * 大事记分组（2026-07-23 一年回填）。
 *
 * 回填一年后单只股可有上百条公告，「资讯」流按时间倒序只看得到最近几个月。
 * 大事记只取**重磅**事件（importance ≥ 重磅线）并按月分组，让一年的脉络一屏可见：
 * 哪个月发生了什么、哪几个月是空的。近月默认展开，远月折叠。
 */

export type MilestoneItem = {
  id: string;
  publishedAt: Date | string;
};

export type MilestoneMonth<T> = {
  /** 排序/展开判定用的稳定键，形如 "2026-07"。 */
  key: string;
  /** 展示用中文标签，形如 "2026年7月"。 */
  label: string;
  items: T[];
};

/** 默认展开最近几个月（更早的折叠，避免一屏几十条）。 */
export const EXPANDED_MONTHS = 2;

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${y}年${Number(m)}月`;
}

/**
 * 按自然月倒序分组（月内保持传入顺序，调用方已按时间倒序取数）。
 * 无效日期归入 "unknown" 组并排到最后，不丢数据也不污染月份序列。
 */
export function groupByMonth<T extends MilestoneItem>(
  items: T[],
): MilestoneMonth<T>[] {
  const byKey = new Map<string, T[]>();
  for (const it of items) {
    const d = new Date(it.publishedAt);
    const key = Number.isNaN(d.getTime()) ? "unknown" : monthKey(d);
    const arr = byKey.get(key);
    if (arr) arr.push(it);
    else byKey.set(key, [it]);
  }
  return [...byKey.entries()]
    .sort((a, b) => {
      if (a[0] === "unknown") return 1;
      if (b[0] === "unknown") return -1;
      return b[0].localeCompare(a[0]);
    })
    .map(([key, group]) => ({
      key,
      label: key === "unknown" ? "时间未知" : monthLabel(key),
      items: group,
    }));
}

/** 该月是否默认展开（最近 EXPANDED_MONTHS 个有内容的月份）。 */
export function isExpanded(index: number): boolean {
  return index < EXPANDED_MONTHS;
}

/** 覆盖跨度描述：「共 N 条 · 覆盖 M 个月」。数字全部来自实际分组，不估算。 */
export function spanSummary<T>(months: MilestoneMonth<T>[]): string {
  const total = months.reduce((n, m) => n + m.items.length, 0);
  const dated = months.filter((m) => m.key !== "unknown").length;
  return `共 ${total} 条 · 覆盖 ${dated} 个月`;
}
