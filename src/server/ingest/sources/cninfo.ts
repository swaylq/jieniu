import type { RawNewsItem, SourceDef } from "../types";
import { detectEventType } from "../../../lib/importance";
import { toValidDate } from "../../../lib/format";

const TOPSEARCH = "http://www.cninfo.com.cn/new/information/topSearch/query";
const HISANN = "http://www.cninfo.com.cn/new/hisAnnouncement/query";
const FORM_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "User-Agent": "Mozilla/5.0 (jieniu-ingest)",
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}

function seDate(): string {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const start = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 400)
    .toISOString()
    .slice(0, 10);
  return `${start}~${end}`;
}

type OrgHit = { code: string; orgId: string };
type Ann = {
  secCode: string;
  secName: string;
  announcementTitle: string;
  announcementTime: number;
  adjunctUrl: string;
};

async function resolveOrgId(code: string): Promise<string> {
  const res = await fetch(TOPSEARCH, {
    method: "POST",
    headers: FORM_HEADERS,
    body: `keyWord=${code}&maxNum=10`,
  });
  if (!res.ok) return "";
  const arr = (await res.json()) as OrgHit[];
  const hit = arr.find((x) => x.code === code) ?? arr[0];
  return hit?.orgId ?? "";
}

async function queryAnnouncements(code: string, orgId: string): Promise<Ann[]> {
  const column = code.startsWith("6") ? "sse" : "szse";
  const body =
    `pageNum=1&pageSize=10&column=${column}&tabName=fulltext` +
    `&stock=${code},${orgId}&seDate=${seDate()}&isHLtitle=false`;
  const res = await fetch(HISANN, {
    method: "POST",
    headers: FORM_HEADERS,
    body,
  });
  if (!res.ok) return [];
  const j = (await res.json()) as { announcements?: Ann[] | null };
  return j.announcements ?? [];
}

/** 逐个股票代码定向拉巨潮公告（GPT P0：公告首选巨潮数据接口，别靠全市场滚动爬虫）。 */
async function fetchByCodes(codes: string[]): Promise<RawNewsItem[]> {
  const out: RawNewsItem[] = [];
  for (const code of codes) {
    const orgId = await resolveOrgId(code);
    await sleep(600);
    if (orgId.length === 0) continue;
    const anns = await queryAnnouncements(code, orgId);
    await sleep(600);
    for (const a of anns) {
      if (!a.adjunctUrl) continue;
      const title = stripTags(a.announcementTitle).slice(0, 200);
      if (title.length === 0) continue;
      out.push({
        externalId: a.adjunctUrl,
        title,
        url: `http://static.cninfo.com.cn/${a.adjunctUrl}`,
        summary: title,
        publishedAt: toValidDate(a.announcementTime),
        eventType: detectEventType(title),
        entityHints: [a.secName, a.secCode].filter(Boolean),
      });
    }
  }
  return out;
}

/**
 * 巨潮资讯网公告 —— 官方披露文件，一手来源(PRIMARY)。
 * 按自选池的股票代码逐个定向拉取；PDF 只存标题+回链，不抓正文（尊重版权）。
 */
export const cninfoAnnouncements: SourceDef = {
  key: "cninfo-announcement",
  name: "巨潮资讯·公告",
  tier: "PRIMARY",
  kind: "official-filing",
  async fetch(dict): Promise<RawNewsItem[]> {
    const codes = Array.from(
      new Set(
        dict.flatMap((e) => (e.type === "STOCK" && e.ticker ? [e.ticker] : [])),
      ),
    );
    return fetchByCodes(codes);
  },
};

/**
 * 定向巨潮公告源（给一组代码就只拉这些股）——用于「重点覆盖」的公告回填 / 轮转刷新，
 * 让热门股即使没在全市场滚动窗口出现，也能补齐自己的公告历史（修「公告 0」）。
 */
export function cninfoForCodes(codes: string[]): SourceDef {
  return {
    key: "cninfo-announcement",
    name: "巨潮资讯·公告",
    tier: "PRIMARY",
    kind: "official-filing",
    fetch: () => fetchByCodes(codes),
  };
}
