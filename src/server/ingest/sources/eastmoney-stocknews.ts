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

// 每股媒体资讯抓取条数——从 5 提到 20，充实个股页深度（sway：确保用户进来看到丰富内容）。
async function fetchStockNews(name: string, code: string, pageSize = 20): Promise<RawNewsItem[]> {
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
    signal: AbortSignal.timeout(15000), // 与 eastmoney-report-sweep 的 15s 一致
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
      const summary = `${media}${stripEm(a.content)}`.slice(0, 300);
      return {
        externalId: a.code,
        title,
        url: a.url,
        summary,
        publishedAt: toValidDate(a.date),
        eventType: detectEventType(title),
        // **搜到的 ≠ 关于它**：这是个搜索接口，`entityHints` 一直被当成权威归属下发，
        // 于是搜索返回什么就往这只股身上绑什么。搜非 A 股名字（携程/泛林/富途这类中概与美股）
        // 时接口基本搜不到东西，退化成返回一批通用最新资讯——**近 7 天携程被绑了 1872 条，
        // 其中 1867 条文章里连「携程」两个字都没有**（「江苏靖江 深耕制造立市」
        // 「上半年上海网络游戏总收入超950亿元」…），泛林 263 条、富途 22 条同理。
        // 这类失败是静默的：fetched 有值、无报错、tagged>0，一切指标正常。
        //
        // 所以只有**文章确实提到了我们搜的这个名字或代码**时才给主体线索；否则交给
        // runner 的文本匹配去决定它属于谁（文章本身照常入库，它可能是别家公司的真资讯）。
        // 实测这一刀剪掉 42.2% 的绑定，而长鑫科技/东方财富/英伟达/苹果这些正常标的
        // 一条都没被剪（含 STOCK 侧那份孪生绑定）。
        ...(mentions(`${title}\n${summary}`, name, code) ? { entityHints: [name, code] } : {}),
      };
    })
    .filter((x) => x.title.length > 0);
}

/** 文章里到底提没提到我们搜的这只股（名字或六位代码）。名字剥掉「(代码)」「-U」这类装饰再比。 */
export function mentions(text: string, name: string, code: string): boolean {
  const bare = name
    .replace(/[（(]\d{4,6}[)）]\s*$/, "")
    .replace(/-(?:U|W|D){1,3}$/i, "")
    .trim();
  if (bare.length >= 2 && text.includes(bare)) return true;
  return code.length >= 4 && text.includes(code);
}

/** 定向个股资讯源（给一组 {name,code} 就只搜这些股）——用于覆盖公司的资讯回填/轮转刷新。 */
export function eastmoneyStockNewsForCodes(
  pairs: { name: string; code: string }[],
  pageSize = 20,
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
          out.push(...(await fetchStockNews(p.name, p.code, pageSize)));
        } catch {
          // 单只失败不影响整批
        }
        await sleep(300);
      }
      return out;
    },
  };
}
