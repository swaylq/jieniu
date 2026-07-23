import type { RawNewsItem, SourceDef } from "../types";
import { toValidDate } from "../../../lib/format";
import { isRatingHeadline } from "../../../lib/compliance";

// 东方财富·券商研报（个股研报列表）——按个股 + 日期区间查询，支持翻页，可回填一年。
// 实测（2026-07-23）：贵州茅台一年 72 篇、宁德时代 38 篇、罗博特科 2 篇，多数一页取完。
//
// **合规（铁律②不荐股/不喊价）**：接口返回 emRatingName(买入/增持)、indvAimPriceT/L(目标价)、
// predict*Eps/Pe(盈利预测) 等字段——这些**一律不读、不入库、不展示**。解牛只把研报当作
// 「某机构在某天发了一篇什么主题的研报」这一**事件**记录，标题含评级/目标价语言的整条丢弃。
// 收录的是研报的存在与主题，不是它的结论。

const LIST = "https://reportapi.eastmoney.com/report/list";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const PAGE_SIZE = 50;
/** 单只一年最多翻的页数（50×6=300，实测最高 72）。 */
const MAX_PAGES = 6;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 只声明会用到的字段——评级/目标价/盈利预测**刻意不进这个类型**，从源头杜绝误用。 */
type Report = {
  title: string;
  stockName: string;
  stockCode: string;
  orgSName: string;
  publishDate: string;
  infoCode: string;
};

function detailUrl(infoCode: string): string {
  return `https://data.eastmoney.com/report/zw_stock.jshtml?infocode=${infoCode}`;
}

async function fetchPage(
  code: string,
  from: Date,
  to: Date,
  pageNo: number,
): Promise<Report[]> {
  const url =
    `${LIST}?cb=x&qType=0&pageSize=${PAGE_SIZE}&pageNo=${pageNo}` +
    `&code=${encodeURIComponent(code)}` +
    `&beginTime=${ymd(from)}&endTime=${ymd(to)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: "https://data.eastmoney.com/" },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`eastmoney-report ${res.status}`);
  const text = await res.text();
  const jsonStr = text.replace(/^[^(]*\(/, "").replace(/\);?\s*$/, "");
  let j: { data?: Report[] };
  try {
    j = JSON.parse(jsonStr) as typeof j;
  } catch {
    return [];
  }
  return j.data ?? [];
}

function toRawItem(r: Report): RawNewsItem | null {
  const raw = r.title?.trim() ?? "";
  if (raw.length === 0) return null;
  // 合规：标题含评级/目标价 → 整条不收（宁可少收，不碰红线）。
  if (isRatingHeadline(raw)) return null;
  const org = r.orgSName?.trim() ?? "";
  // 机构名放**后缀**：放前缀会被 stripEntityPrefix 当作「公司名:」剪掉，
  // 导致不同券商同日的同名研报（「2026年半年报点评」）被判成重复而丢失。
  const title = (org ? `${raw}（${org}）` : raw).slice(0, 200);
  return {
    externalId: r.infoCode,
    title,
    url: detailUrl(r.infoCode),
    // summary 与 title 同值（同公告源做法）：机构已在来源徽标和标题后缀里出现两次，
    // 再加一行「XX研报」纯属重复——summaryIsRedundant 会据此把摘要行隐藏掉。
    summary: title,
    publishedAt: toValidDate(r.publishDate),
    eventType: "研报",
    entityHints: [r.stockName, r.stockCode].filter(Boolean),
  };
}

/**
 * 定向研报源：给一组代码 + 时间区间，翻页拉全区间研报。
 * MEDIA 级（券商观点是二手解读，不是一手披露）。单只失败只跳过该只。
 */
export function eastmoneyReportsForCodes(
  codes: string[],
  from: Date,
  to: Date,
): SourceDef {
  return {
    key: "eastmoney-report",
    name: "东方财富·券商研报",
    tier: "MEDIA",
    kind: "json-api",
    async fetch(): Promise<RawNewsItem[]> {
      const out: RawNewsItem[] = [];
      for (const code of codes) {
        try {
          for (let page = 1; page <= MAX_PAGES; page++) {
            const list = await fetchPage(code, from, to, page);
            if (list.length === 0) break;
            for (const r of list) {
              const item = toRawItem(r);
              if (item) out.push(item);
            }
            await sleep(250);
            if (list.length < PAGE_SIZE) break;
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
