import type { RawNewsItem, SourceDef } from "../types";

const API =
  "https://np-weblist.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=30&req_trace=1";

type EmItem = {
  title?: string;
  summary?: string;
  code?: string;
  showTime?: string;
};
type EmResp = { data?: { fastNewsList?: EmItem[] } };

/** 解析东财快讯 JSON（纯函数，便于单测）。 */
export function parseEastmoneyFastNews(json: EmResp): RawNewsItem[] {
  const list = json.data?.fastNewsList ?? [];
  return list
    .map((it): RawNewsItem | null => {
      const title = (it.title ?? "").trim();
      const code = (it.code ?? "").trim();
      if (title === "" || code === "") return null;
      const s = (it.summary ?? "").trim();
      const summary = s !== "" ? s : title;
      const parsed = it.showTime
        ? new Date(it.showTime.replace(" ", "T"))
        : null;
      const publishedAt =
        parsed && !isNaN(parsed.getTime()) ? parsed : new Date();
      return {
        externalId: code,
        title: title.slice(0, 150),
        url: `https://finance.eastmoney.com/a/${code}.html`,
        summary: summary.slice(0, 500),
        content: summary,
        publishedAt,
      };
    })
    .filter((x): x is RawNewsItem => x !== null);
}

/** 东方财富 7×24 快讯（开放 JSON，sortEnd 传空取最新一页）。媒体级。 */
export const eastmoneyFastNews: SourceDef = {
  key: "eastmoney-kuaixun",
  name: "东方财富·快讯",
  tier: "MEDIA",
  kind: "json-api",
  async fetch(): Promise<RawNewsItem[]> {
    const res = await fetch(API, {
      headers: {
        "User-Agent": "Mozilla/5.0 (jieniu-ingest)",
        Referer: "https://kuaixun.eastmoney.com/",
      },
    });
    if (!res.ok) throw new Error(`eastmoney ${res.status}`);
    const json = (await res.json()) as EmResp;
    return parseEastmoneyFastNews(json);
  },
};
