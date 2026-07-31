/**
 * 「催化临近」窗口（2026-07-31）——首页四张状态卡的第四张。
 *
 * 原来这张卡的数字是 `upcomingDisclosureNodes(now, 2).length`，也就是**写死的 2**：
 * 它数的是「接下来两个 A 股法定披露截止日」，跟用户是谁、盯了什么、临不临近全都无关，
 * 所以永远显示 2（张楚寒 7-31：「为什么一直都是 0002」）。
 *
 * 这里改成数**你自己的**节点：自选标的里，未来 N 天内有交易所预约披露日的有几家。
 * 数据来自 `EntitySignal(kind="disclosure")`（东财 `RPT_PUBLIC_BS_APPOIN`，公司报备的确定性日程），
 * 全库 5500 只 STOCK 里 5256 只有值——够真、够动。铁律不变：只搬确定性日程、不预测披露日，
 * 预约日已过的不显示（挂着一个过去的节点比没有更糟）。
 *
 * 纯函数、零 AI、可测。日期一律按**本地日**比较（源给的是裸日期，走 UTC 会整体偏一天）。
 */

import { parseLocalDay } from "./disclosure";

/** 默认窗口：30 天。半年报预约日成簇落在 8/19–8/31，7 天窗口对全体用户长期为 0，等于换了个写法的死数字。 */
export const CATALYST_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type CatalystRow = {
  entityId: string;
  name: string;
  periodLabel: string;
  /** YYYY-MM-DD（本地日历日）。 */
  date: string;
};

export type CatalystItem = CatalystRow & {
  /** 距今自然日；今天披露 = 0。 */
  daysUntil: number;
};

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 你的自选里、未来 windowDays 天内要披露的，按由近到远排。同一标的只留最近一条。 */
export function upcomingCatalysts(
  rows: CatalystRow[],
  now: Date = new Date(),
  windowDays: number = CATALYST_WINDOW_DAYS,
): CatalystItem[] {
  const today = startOfDay(now).getTime();
  const best = new Map<string, CatalystItem>();
  for (const r of rows) {
    const at = parseLocalDay(r.date);
    if (!at) continue; // 解析不出来就丢，不猜
    const daysUntil = Math.round((startOfDay(at).getTime() - today) / DAY_MS);
    if (daysUntil < 0 || daysUntil > windowDays) continue;
    const cur = best.get(r.entityId);
    if (!cur || daysUntil < cur.daysUntil) best.set(r.entityId, { ...r, daysUntil });
  }
  return [...best.values()].sort(
    (a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name),
  );
}

/** 卡片副文案：有节点就点名最近那个（谁、哪天、还有几天），没有就如实说没有。 */
export function catalystCaption(
  items: CatalystItem[],
  windowDays: number = CATALYST_WINDOW_DAYS,
): string {
  const first = items[0];
  if (!first) return `未来 ${windowDays} 天你的自选没有财报节点`;
  const at = parseLocalDay(first.date);
  const when = at ? `${at.getMonth() + 1}/${at.getDate()}` : first.date;
  return `最近：${first.name} ${when} 披露，还有 ${first.daysUntil} 天`;
}
