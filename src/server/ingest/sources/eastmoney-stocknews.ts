import type { RawNewsItem, SourceDef } from "../types";
import { detectEventType } from "../../../lib/importance";
import { toValidDate } from "../../../lib/format";

// 东方财富统一搜索——个股资讯「聚合接口」（GPT P1：公司新闻/产业/政策，走聚合接口）。
// 按股票名定向搜，聚合第一财经/证券时报等多家媒体，补齐个股页的媒体资讯（不止公告）。
// 只存 标题 + 摘要片段 + 回链（搜索结果式，尊重版权，不抓全文）。

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const SEARCH = "https://search-api-web.eastmoney.com/search/jsonp";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const stripEm = (s: string) => s.replace(/<\/?em>/gi, "").trim();

type Article = {
  code: string;
  title: string;
  content: string;
  date: string;
  url: string;
  mediaName?: string;
};

async function fetchStockNews(name: string, code: string, pageSize = 5): Promise<RawNewsItem[]> {
  const param = encodeURIComponent(
    JSON.stringify({
      uid: "",
      keyword: name,
      type: ["cmsArticleWebOld"],
      client: "web",
      clientType: "web",
      param: {
        cmsArticleWebOld: { searchScope: "default", sort: "time", pageIndex: 1, pageSize },
      },
    }),
  );
  const res = await fetch(`${SEARCH}?cb=x&param=${param}`, {
    headers: { "User-Agent": UA, Referer: "https://so.eastmoney.com/" },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const text = await res.text();
  const jsonStr = text.replace(/^[^(]*\(/, "").replace(/\);?\s*$/, "");
  let j: { result?: { cmsArticleWebOld?: Article[] } };
  try {
    j = JSON.parse(jsonStr) as typeof j;
  } catch {
    return [];
  }
  const arr = j.result?.cmsArticleWebOld ?? [];
  return arr
    .map((a): RawNewsItem => {
      const title = stripEm(a.title).slice(0, 200);
      const media = a.mediaName ? `【${a.mediaName}】` : "";
      return {
        externalId: a.code,
        title,
        url: a.url,
        summary: `${media}${stripEm(a.content)}`.slice(0, 300),
        publishedAt: toValidDate(a.date),
        eventType: detectEventType(title),
        entityHints: [name, code],
      };
    })
    .filter((x) => x.title.length > 0);
}

/** 定向个股资讯源（给一组 {name,code} 就只搜这些股）——用于覆盖公司的资讯回填/轮转刷新。 */
export function eastmoneyStockNewsForCodes(
  pairs: { name: string; code: string }[],
): SourceDef {
  return {
    key: "eastmoney-stocknews",
    name: "东方财富·个股资讯",
    tier: "MEDIA",
    kind: "json-api",
    async fetch() {
      const out: RawNewsItem[] = [];
      for (const p of pairs) {
        try {
          out.push(...(await fetchStockNews(p.name, p.code)));
        } catch {
          // 单只失败不影响整批
        }
        await sleep(300);
      }
      return out;
    },
  };
}
