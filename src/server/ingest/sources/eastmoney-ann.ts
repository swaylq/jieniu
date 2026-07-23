import type { RawNewsItem, SourceDef } from "../types";
import { detectEventType } from "../../../lib/importance";
import { toValidDate } from "../../../lib/format";
import { isDelistingNoise } from "../../../lib/universe";

const LIST =
  "https://np-anotice-stock.eastmoney.com/api/security/ann" +
  "?sr=-1&page_size=50&page_index=1&ann_type=A&client_source=web&f_node=0&s_node=0";
const HIST = "https://np-anotice-stock.eastmoney.com/api/security/ann";
const CONTENT = "https://np-cnotice-stock.eastmoney.com/api/content/ann";
const UA = "Mozilla/5.0 (jieniu-ingest)";

type EmCode = { stock_code: string; short_name: string };
type EmColumn = { column_name: string };
type EmAnn = {
  art_code: string;
  title: string;
  notice_date?: string;
  display_time?: string;
  codes?: EmCode[];
  columns?: EmColumn[];
};

/** 东财公告详情页链接（enrich 再据 art_code 拉正文）。 */
function detailUrl(stockCode: string, artCode: string): string {
  return `https://data.eastmoney.com/notices/detail/${stockCode}/${artCode}.html`;
}

/** 一条东财公告 → RawNewsItem；无归属代码 / 空标题 / 退市噪声 返回 null。 */
function toRawItem(a: EmAnn): RawNewsItem | null {
  const code = a.codes?.[0];
  if (!code) return null;
  const title = a.title.trim().slice(0, 200);
  if (title.length === 0) return null;
  // 退市 / ST 个股的公告——关注的人根本没有（张楚寒 2026-07-13），源头不爬。
  if (isDelistingNoise(code.short_name, title)) return null;
  // 事件类型只认标题（公告标题已自述类型）；不扫正文，避免正文偶现关键词误判。
  return {
    externalId: a.art_code,
    title,
    url: detailUrl(code.stock_code, a.art_code),
    summary: title,
    publishedAt: toValidDate(a.notice_date ?? a.display_time ?? ""),
    eventType: detectEventType(title),
    entityHints: [code.short_name, code.stock_code].filter(Boolean),
  };
}

/**
 * 东方财富·公告 —— 全市场实时公告（官方披露），一手来源(PRIMARY)。
 * 相比只查自选 8 只股的巨潮，这里拉全市场最新公告；正文由 enrich 走内容接口补全。
 */
export const eastmoneyAnnouncements: SourceDef = {
  key: "eastmoney-announcement",
  name: "东方财富·公告",
  tier: "PRIMARY",
  kind: "official-filing",
  async fetch(): Promise<RawNewsItem[]> {
    const res = await fetch(LIST, {
      headers: { "User-Agent": UA },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`eastmoney-ann ${res.status}`);
    const j = (await res.json()) as { data?: { list?: EmAnn[] } };
    const list = j.data?.list ?? [];
    return list
      .map(toRawItem)
      .filter((x): x is RawNewsItem => x !== null);
  },
};

// ── 历史回填 ────────────────────────────────────────────────────────────────
// 同一接口支持 stock_list=<代码> + begin_time/end_time 精确到个股与区间，翻页到空为止。
// 实测（2026-07-23）：宁德时代一年 226 条、5 页取完，与巨潮 hisAnnouncement 的 222 条交叉一致；
// page_size=50 有效，而巨潮 pageSize 服务端硬上限只有 30、且要先查 orgId 多一个请求。
// 故历史回填走东财，不走巨潮。

const ANN_PAGE_SIZE = 50;
/** 单只一年最多翻的页数（50×14=700，实测最高 226，留足冗余同时防翻页失控）。 */
const MAX_PAGES = 14;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchAnnPage(
  code: string,
  from: Date,
  to: Date,
  pageIndex: number,
): Promise<EmAnn[]> {
  const url =
    `${HIST}?sr=-1&ann_type=A&client_source=web` +
    `&page_size=${ANN_PAGE_SIZE}&page_index=${pageIndex}` +
    `&stock_list=${encodeURIComponent(code)}` +
    `&begin_time=${ymd(from)}&end_time=${ymd(to)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`eastmoney-ann-hist ${res.status}`);
  const j = (await res.json()) as { data?: { list?: EmAnn[] } };
  return j.data?.list ?? [];
}

/**
 * 定向历史公告源：给一组代码 + 时间区间，翻页拉全该区间的公告。
 * 用于「过去一年」回填；单只失败只跳过该只，不中断整批。
 */
export function eastmoneyAnnForCodes(
  codes: string[],
  from: Date,
  to: Date,
): SourceDef {
  return {
    key: "eastmoney-announcement",
    name: "东方财富·公告",
    tier: "PRIMARY",
    kind: "official-filing",
    async fetch(): Promise<RawNewsItem[]> {
      const out: RawNewsItem[] = [];
      for (const code of codes) {
        try {
          for (let page = 1; page <= MAX_PAGES; page++) {
            const list = await fetchAnnPage(code, from, to, page);
            if (list.length === 0) break;
            for (const a of list) {
              const item = toRawItem(a);
              if (item) out.push(item);
            }
            await sleep(250);
            if (list.length < ANN_PAGE_SIZE) break; // 不满页即已到底
          }
        } catch {
          // 单只失败不影响整批
        }
        await sleep(150);
      }
      return out;
    },
  };
}

/** 据 art_code 拉公告正文（东财内容接口，已把 PDF 解析成文本）；失败返回 null。 */
export async function fetchEastmoneyAnnText(
  artCode: string,
  maxLen = 4000,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${CONTENT}?art_code=${artCode}&client_source=web&page_index=1`,
      { headers: { "User-Agent": UA }, cache: "no-store" },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { data?: { notice_content?: string } };
    const raw = j.data?.notice_content ?? "";
    const text = raw
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return text.length > 20 ? text.slice(0, maxLen) : null;
  } catch {
    return null;
  }
}
