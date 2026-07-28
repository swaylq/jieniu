/**
 * 日线解析（纯函数）。两个源同形归一，供「历史财报日涨跌幅」统计使用。
 *
 * 主源东财 push2his：`klines: ["2026-04-20,1382.87,0.26", …]`（日期,收盘,涨跌幅）。
 * 备源新浪：JSON 数组、**不给涨跌幅**，由相邻收盘价推算——东财 push2 对本节点间歇封锁，
 * 估值卡已经因此加过腾讯兜底，这里同理不把可用性押在单一主机上。
 */

export type Bar = {
  day: string; // YYYY-MM-DD
  close: number;
  changePct: number;
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function byDayAsc(a: Bar, b: Bar): number {
  return a.day.localeCompare(b.day);
}

/** 东财 push2his（fields2=f51,f53,f59）→ Bar[]。结构不对返回 []。 */
export function parseEastmoneyKlines(json: unknown): Bar[] {
  const klines = (json as { data?: { klines?: unknown } } | null)?.data?.klines;
  if (!Array.isArray(klines)) return [];
  const bars: Bar[] = [];
  for (const line of klines) {
    if (typeof line !== "string") continue;
    const [day, close, chg] = line.split(",");
    if (!day || !DAY_RE.test(day)) continue;
    const c = Number(close);
    const p = Number(chg);
    if (!Number.isFinite(c) || !Number.isFinite(p)) continue;
    bars.push({ day, close: c, changePct: p });
  }
  return bars.sort(byDayAsc);
}

/** 新浪 getKLineData → Bar[]。涨跌幅由相邻收盘价推算；首根无前收记 0（不编）。 */
export function parseSinaKlines(json: unknown): Bar[] {
  if (!Array.isArray(json)) return [];
  const rows: { day: string; close: number }[] = [];
  for (const item of json) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const day = typeof r.day === "string" ? r.day.slice(0, 10) : "";
    if (!DAY_RE.test(day)) continue;
    const close = Number(r.close);
    if (!Number.isFinite(close) || close <= 0) continue;
    rows.push({ day, close });
  }
  rows.sort((a, b) => a.day.localeCompare(b.day));
  return rows.map((r, i) => {
    const prev = i > 0 ? rows[i - 1]!.close : 0;
    const changePct =
      prev > 0 ? Math.round(((r.close - prev) / prev) * 10000) / 100 : 0;
    return { day: r.day, close: r.close, changePct };
  });
}
