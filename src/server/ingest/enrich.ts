import type { PrismaClient } from "../../../generated/prisma";
import { fetchPdfText } from "./pdf-text";
import { fetchEastmoneyAnnText } from "./sources/eastmoney-ann";
import { detectEventType, scoreImportance } from "../../lib/importance";

/** 按 url 选正文抓取方式：巨潮 PDF 走 pdftotext；东财公告详情页据 art_code 走内容接口。 */
async function fetchContentFor(url: string): Promise<string | null> {
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
