import type { RawNewsItem, SourceDef } from "../types";
import { detectEventType } from "../../../lib/importance";
import { toValidDate } from "../../../lib/format";
import { isDelistingNoise } from "../../../lib/universe";

const LIST =
  "https://np-anotice-stock.eastmoney.com/api/security/ann" +
  "?sr=-1&page_size=50&page_index=1&ann_type=A&client_source=web&f_node=0&s_node=0";
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

    const out: RawNewsItem[] = [];
    for (const a of list) {
      const code = a.codes?.[0];
      if (!code) continue;
      const title = a.title.trim().slice(0, 200);
      if (title.length === 0) continue;
      // 退市 / ST 个股的公告——关注的人根本没有（张楚寒 2026-07-13），源头不爬。
      if (isDelistingNoise(code.short_name, title)) continue;
      // 事件类型只认标题（公告标题已自述类型）；不扫正文，避免正文偶现关键词误判。
      out.push({
        externalId: a.art_code,
        title,
        url: detailUrl(code.stock_code, a.art_code),
        summary: title,
        publishedAt: toValidDate(a.notice_date ?? a.display_time ?? ""),
        eventType: detectEventType(title),
        entityHints: [code.short_name, code.stock_code].filter(Boolean),
      });
    }
    return out;
  },
};

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
