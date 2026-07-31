import type { RawNewsItem, SourceDef } from "../types";
import { isRatingHeadline } from "../../../lib/compliance";

/**
 * 东方财富·券商研报（**全市场扫描**）。
 *
 * 与既有的 `eastmoney-report.ts` 是两种形态、互补：
 *  · 那一份按**个股定向**（`code=`），一次一只，适合给某只股回填一年历史；
 *    但要覆盖全市场就是 5500 次请求，所以它实际只在轮转回填里跑，
 *    结果是**近 7 天全库只有 8 篇研报**（实测 2026-07-31）。
 *  · 这一份用 `industryCode=*` 按**日期区间**扫全市场，一次请求 100 条，
 *    近 7 天实测 85 篇（qType=0 个股研报），几页就取完。
 *
 * **合规（铁律②不荐股/不喊价）**：接口回的 `emRatingName`(买入/增持)、
 * `indvAimPrice*`(目标价)、`predict*Eps`(盈利预测) 一律不读、不入库、不展示——
 * 连类型声明里都不写，从源头杜绝误用。标题里带评级/目标价语言的整条丢弃。
 * 收录的是「某机构某天发了一篇什么主题的研报」这个**事件**，不是它的结论。
 */

const LIST = "https://reportapi.eastmoney.com/report/list";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const PAGE_SIZE = 100;
/** 页数上限：近 7 天实测 85 条，留足余量当保险丝。 */
const MAX_PAGES = 12;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** 只声明会用到的字段——评级/目标价/盈利预测**刻意不在这里出现**。 */
type SweepRow = {
  title?: unknown;
  stockName?: unknown;
  stockCode?: unknown;
  orgSName?: unknown;
  publishDate?: unknown;
  infoCode?: unknown;
};

function detailUrl(infoCode: string): string {
  return `https://data.eastmoney.com/report/zw_stock.jshtml?infocode=${infoCode}`;
}

/** 一页响应 → 归一化条目。结构不对返回 []，不抛。 */
export function parseSweepPage(json: unknown): RawNewsItem[] {
  const rows = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return [];
  const out: RawNewsItem[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as SweepRow;
    const title = typeof r.title === "string" ? r.title.trim() : "";
    const code = typeof r.stockCode === "string" ? r.stockCode.trim() : "";
    const info = typeof r.infoCode === "string" ? r.infoCode.trim() : "";
    const org = typeof r.orgSName === "string" ? r.orgSName.trim() : "";
    const name = typeof r.stockName === "string" ? r.stockName.trim() : "";
    if (!title || !code || !info) continue;
    // 合规：标题里带评级/目标价语言的整条不要
    if (isRatingHeadline(title)) continue;
    /**
     * **不用 `toValidDate`**：它对坏日期回退成「现在」，而研报是催化证据——
     * 一个坏日期会让一年前的研报冒充今天发布，直接混进近 4 天的催化窗口。
     * 这里显式校验 `YYYY-MM-DD`，认不出就整条丢掉。
     */
    const dayStr =
      typeof r.publishDate === "string" ? r.publishDate.slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayStr)) continue;
    const publishedAt = new Date(`${dayStr}T00:00:00.000Z`);
    if (Number.isNaN(publishedAt.getTime())) continue;
    out.push({
      externalId: info,
      title,
      url: detailUrl(info),
      summary: `${org ? `${org}发布` : "券商"}研报：${title}`,
      publishedAt,
      eventType: "研报",
      // 主体由源权威给出（stockCode + stockName），配合 subjectOnly 只绑这一只
      entityHints: [code, name].filter(Boolean),
    });
  }
  return out;
}

async function fetchPage(
  from: Date,
  to: Date,
  pageNo: number,
): Promise<{ rows: RawNewsItem[]; hits: number } | null> {
  const url =
    `${LIST}?industryCode=*&qType=0&pageSize=${PAGE_SIZE}&pageNo=${pageNo}` +
    `&beginTime=${ymd(from)}&endTime=${ymd(to)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Referer: "https://data.eastmoney.com/report/" },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { hits?: number };
    return { rows: parseSweepPage(json), hits: Number(json.hits ?? 0) };
  } catch (e) {
    // 不裸 catch：端点变了会 100% 失败，静默会让研报供给悄悄归零
    console.error(
      `[report-sweep] 第 ${pageNo} 页取不到：`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/**
 * 近 `days` 天的全市场研报扫描。
 * 用接口回传的 `hits` 算该翻几页——不靠「翻到空为止」
 * （被限流的空页和真的翻到底长得一模一样，这是踩过的坑）。
 */
export function eastmoneyReportSweep(days = 7, now = new Date()): SourceDef {
  const to = now;
  const from = new Date(now.getTime() - days * 24 * 3600 * 1000);
  return {
    key: "eastmoney-report-sweep",
    name: "东方财富·券商研报",
    tier: "MEDIA",
    kind: "report",
    subjectOnly: true,
    fetch: async () => {
      const first = await fetchPage(from, to, 1);
      if (!first) return [];
      const out = [...first.rows];
      const pages = Math.min(MAX_PAGES, Math.ceil(first.hits / PAGE_SIZE));
      for (let p = 2; p <= pages; p++) {
        const r = await fetchPage(from, to, p);
        if (r) out.push(...r.rows);
        await sleep(200);
      }
      return out;
    },
  };
}
