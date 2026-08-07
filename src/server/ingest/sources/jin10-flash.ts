import type { RawNewsItem, SourceDef } from "../types";

/**
 * 金十数据 7×24 快讯。
 *
 * 定位跟别的源不一样：**它不是拿来补个股资讯的**。2026-08-03 实测只有约 20% 跟 A 股沾边，
 * 主体是全球宏观 / 商品 / 外汇 / 海外股市——正好补「今日复盘」国际·国内那两层长期偏薄的缺口
 * （见 lessons「三层大事信息量」）。个股绑定它一条都不给，天然不会进个股页。
 *
 * 端点选择（实测对比后取 `flash_newest.js`）：
 *  - `flash_newest.js`：裸 curl 就通，**一次 50 条、覆盖约 45 分钟**，代价是要从
 *    `var newest = [...];` 的 JS 壳里剥 JSON；
 *  - `flash-api.jin10.com/get_flash_list`：标准 JSON，但**一次只给 21 条（约 9~27 分钟）**，
 *    要靠 `max_time` 翻页才够 30 分钟一轮的覆盖，还得带 `x-app-id` 这种迟早会变的硬编码 ID。
 *  两者数据结构一致，`parseJin10Flash` 两种形态都吃。
 *
 * 其他实测坑：
 *  - `channel` 参数是摆设：试了 -8200/1/2/3/5 五个值，返回**完全一样**，别指望用它筛 A 股；
 *  - 流里混着自家付费内容引流（`type=2` + `tag=VIP` + 链到 `xnews.jin10.com`），要丢；
 *  - `type=1` 是经济数据日历（瑞士 CPI 那种），只有 `actual/consensus` 数字、没有可读标题，要丢；
 *  - 正文偶尔带 `<b>` 标签（实测 50 条里 1 条），标题要在截断前剥掉；
 *  - 日产量约 1000 条。首页「最新」是纯时间倒序无门槛的流，全量入库会把它淹掉，
 *    所以这里只留金十自己标的 `important=1`（实测占比约 30%），把量压到跟其他媒体源同一量级。
 */

const API = "https://www.jin10.com/flash_newest.js";
/** 翻页备用端点：`flash_newest.js` 没有翻页参数，窗口不够时靠它往前补。 */
const PAGE_API = "https://flash-api.jin10.com/get_flash_list?channel=-8200&vip=1";
const UA = "Mozilla/5.0 (jieniu-ingest)";
/** ingest 是 30 分钟一轮 + 最多 5 分钟 jitter；窗口要盖住最坏情况还留点余量。 */
const NEED_WINDOW_MIN = 45;

type JinRow = {
  id?: string | number;
  time?: string;
  type?: number;
  important?: number;
  data?: {
    title?: string;
    content?: string;
    link?: string;
    tag?: string;
  };
};

const WIRE_PREFIX = /^金十数据[^，,]{0,12}[讯电]\s*[，,]\s*/;

/** 金十把同一条快讯中英双推（实测 9 条里 4 条是英文版）——只留中文那份。 */
const HAS_CJK = /[一-龥]/;

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}

function titleFromBody(body: string): string {
  const bracket = /^【([^】]{2,120})】/.exec(body);
  if (bracket) return bracket[1]!.trim();
  const stripped = body.replace(WIRE_PREFIX, "");
  return (stripped.split(/[。！？\n]/)[0] ?? "").trim();
}

/**
 * 从 `var newest = [...];` 的 JS 壳里剥出数组。
 * 剥不出来返回空数组——端点改版是静默的，让它在「抓到 0 条」处暴露，别把整轮 ingest 掀掉。
 */
export function extractNewestArray(js: string): unknown[] {
  const start = js.indexOf("[");
  const end = js.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed: unknown = JSON.parse(js.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function timeOf(row: unknown): number {
  const t = (row as { time?: string })?.time;
  if (typeof t !== "string" || t.length === 0) return NaN;
  return new Date(`${t.trim().replace(" ", "T")}+08:00`).getTime();
}

/** 一批条目覆盖的时间跨度（分钟）；不足 2 条有效时间戳则返回 0。 */
export function windowMinutes(rows: unknown[]): number {
  const ts = rows.map(timeOf).filter((n) => !isNaN(n));
  if (ts.length < 2) return 0;
  return (Math.max(...ts) - Math.min(...ts)) / 60000;
}

/** 按 id 去重合并两页，结果按时间倒序（缺 time 的排在最后但不丢）。 */
export function mergeByWindow(first: unknown[], second: unknown[]): unknown[] {
  const byId = new Map<string, unknown>();
  for (const r of [...first, ...second]) {
    const id = String((r as { id?: string | number })?.id ?? "");
    if (id.length > 0 && !byId.has(id)) byId.set(id, r);
  }
  return [...byId.values()].sort((a, b) => {
    const ta = timeOf(a);
    const tb = timeOf(b);
    if (isNaN(ta) && isNaN(tb)) return 0;
    if (isNaN(ta)) return 1;
    if (isNaN(tb)) return -1;
    return tb - ta;
  });
}

/** 金十快讯 → RawNewsItem（广告 / 数据日历 / 非重要条目在这里就筛掉）。 */
export function parseJin10Flash(json: unknown): RawNewsItem[] {
  const rows: JinRow[] = Array.isArray(json)
    ? (json as JinRow[])
    : ((json as { data?: JinRow[] } | null)?.data ?? []);
  if (!Array.isArray(rows)) return [];

  const out: RawNewsItem[] = [];
  for (const r of rows) {
    if (r.type === 1) continue; // 经济数据日历，无标题
    if (r.type === 2) continue; // 自家 xnews 付费内容
    if (r.important !== 1) continue; // 只收金十标重的

    const d = r.data ?? {};
    const link = (d.link ?? "").trim();
    if ((d.tag ?? "").trim() === "VIP") continue;
    if (link.includes("xnews.jin10.com")) continue;

    const body = stripHtml(d.content ?? "");
    const rawTitle = stripHtml(d.title ?? "");
    const title = (rawTitle.length > 0 ? rawTitle : titleFromBody(body)).slice(
      0,
      120,
    );
    if (title.length === 0) continue;
    if (!HAS_CJK.test(title)) continue; // 英文版重复条

    const id = String(r.id ?? "");
    if (id.length === 0) continue;

    out.push({
      externalId: id,
      title,
      url: link.length > 0 ? link : `https://www.jin10.com/detail/${id}`,
      summary: body.slice(0, 500),
      content: body.length > 0 ? body : undefined,
      // "2026-08-03 14:46:17" 是东八区壁钟时间，必须显式补 +08:00——
      // 裸 new Date() 会跟着运行机器的时区漂（见 lessons「时间戳无时区陷阱」）。
      publishedAt: new Date(`${(r.time ?? "").trim().replace(" ", "T")}+08:00`),
    });
  }
  return out;
}

/** 金十数据快讯（全球宏观/商品，喂复盘的国际·国内层）。 */
export const jin10Flash: SourceDef = {
  key: "jin10-flash",
  name: "金十数据快讯",
  tier: "MEDIA",
  kind: "json-api",
  async fetch(): Promise<RawNewsItem[]> {
    const res = await fetch(API, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(15000), // 与 eastmoney-report-sweep 的 15s 一致
    });
    if (!res.ok) throw new Error(`jin10-flash ${res.status}`);
    let raw = extractNewestArray(await res.text());

    // `flash_newest.js` 固定 50 条、没有翻页参数，能覆盖多久全看快讯密度。
    // 上线首轮就实测到「窗口仅 25 分钟 < 35 分钟」——不是理论风险。
    // 不够就用带 max_time 的备用端点往前补，最多两页（够到约 1.5 小时）。
    for (let page = 0; page < 2 && windowMinutes(raw) < NEED_WINDOW_MIN; page++) {
      const oldest = raw
        .map((r) => (r as { time?: string })?.time)
        .filter((t): t is string => typeof t === "string" && t.length > 0)
        .sort()[0];
      if (!oldest) break;
      const more = await fetchOlderThan(oldest);
      if (more.length === 0) break;
      const before = raw.length;
      raw = mergeByWindow(raw, more);
      if (raw.length === before) break; // 没拿到新条目，别空转
    }

    const span = windowMinutes(raw);
    if (span < NEED_WINDOW_MIN) {
      console.warn(
        `[jin10-flash] 补页后覆盖窗口仍只有 ${span.toFixed(0)} 分钟（目标 ${NEED_WINDOW_MIN}）——本轮之前的快讯可能已经丢了`,
      );
    }
    return parseJin10Flash(raw);
  },
};

/** 取比 `time` 更早的一页（备用端点，实测 max_time 有效而 end_time 无效）。 */
async function fetchOlderThan(time: string): Promise<unknown[]> {
  try {
    const res = await fetch(`${PAGE_API}&max_time=${encodeURIComponent(time)}`, {
      headers: {
        "User-Agent": UA,
        "x-app-id": "bVBF4FyRTn5NJF5n",
        "x-version": "1.0.0",
        Referer: "https://www.jin10.com/",
      },
      signal: AbortSignal.timeout(15000), // 与 eastmoney-report-sweep 的 15s 一致
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: unknown[] };
    return Array.isArray(json.data) ? json.data : [];
  } catch {
    // 备用端点挂了不该拖垮主流程——主端点那 50 条照常入库。
    return [];
  }
}
