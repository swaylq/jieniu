import type { PrismaClient } from "../../../generated/prisma";
import { isIP } from "node:net";
import { fetchPdfText } from "./pdf-text";
import { fetchEastmoneyAnnText } from "./sources/eastmoney-ann";
import { detectEventType, scoreImportance } from "../../lib/importance";

// ── SSRF 纵深防御 ────────────────────────────────────────────────────────────
// enrich 会对 DB 里存的 newsItem.url 发 fetch（PDF / 东财公告正文）。URL 都是入库源
// 写死的模板、host 固定，正常不会出问题；但这是「拿库里的 URL 去请求外部」，一旦 DB 被
// 污染就得多防一手：只允许已知资讯域、拒绝内网/回环/链路本地，避免把内网元数据或本机
// 服务探出来（169.254.169.254 之类的云元数据端点是最典型的坑）。
const ALLOWED_FETCH_HOSTS = new Set([
  "static.cninfo.com.cn", // 巨潮 PDF
  "data.eastmoney.com", // 东财公告详情页（正文另走固定内容接口，URL 只用来取 art_code）
]);

function isPrivateIpLiteral(host: string): boolean {
  if (isIP(host) === 0) return false;
  const h = host.toLowerCase();
  if (h === "::1" || h.startsWith("127.")) return true;
  if (h.startsWith("fe80:")) return true;
  if (/^(10\.|192\.168\.|169\.254\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

/** 这个 URL 是否允许被 enrich 抓正文：白名单资讯域 + 非内网地址。 */
export function isAllowedFetchUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (!ALLOWED_FETCH_HOSTS.has(u.hostname)) return false;
  return !isPrivateIpLiteral(u.hostname);
}

/** 按 url 选正文抓取方式：巨潮 PDF 走 pdftotext；东财公告详情页据 art_code 走内容接口。 */
async function fetchContentFor(url: string): Promise<string | null> {
  // SSRF 纵深防御：库里的 URL 只允许抓白名单资讯域（见 isAllowedFetchUrl）。
  if (!isAllowedFetchUrl(url)) return null;
  if (/\.pdf$/i.test(url)) return fetchPdfText(url);
  const m = /\/notices\/detail\/[^/]+\/([A-Za-z0-9]+)\.html/.exec(url);
  if (m?.[1]) return fetchEastmoneyAnnText(m[1]);
  return null;
}

/**
 * 正文兜底：给「无正文的公告」补全文（巨潮 PDF 或 东财内容接口）。
 * 每轮限量、逐条失败跳过；补到正文后用标题(优先)重算 eventType/importance，
 * 并把「摘要==标题」的公告换成正文摘要。返回本轮补全条数。
 */
export async function enrichPdfContent(
  db: PrismaClient,
  limit = 30,
): Promise<number> {
  const rows = await db.newsItem.findMany({
    where: {
      AND: [
        { OR: [{ content: null }, { content: "" }] },
        {
          OR: [
            { url: { endsWith: ".PDF" } },
            { url: { contains: "/notices/detail/" } },
          ],
        },
      ],
    },
    orderBy: { publishedAt: "desc" },
    take: limit,
    select: {
      id: true,
      url: true,
      title: true,
      summary: true,
      tier: true,
      eventType: true,
    },
  });

  let filled = 0;
  for (const r of rows) {
    const text = await fetchContentFor(r.url);
    if (!text || text.length <= 20) continue;

    // 沿用爬取时按标题定的事件类型（缺失才据标题补），不扫正文——正文关键词会误判。
    const eventType = r.eventType ?? detectEventType(r.title);
    const importance = scoreImportance({ tier: r.tier, eventType });
    const data: {
      content: string;
      importance: number;
      eventType: string | null;
      summary?: string;
    } = { content: text, importance, eventType };
    if (!r.summary || r.summary === r.title) {
      data.summary = text.replace(/\s+/g, " ").slice(0, 180);
    }
    await db.newsItem.update({ where: { id: r.id }, data });
    filled++;
  }
  return filled;
}
