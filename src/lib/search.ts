// 搜索结果去重（产品质量循环 2026-07-15 run4）。
//
// 数据模型里每家公司有 COMPANY(带 thesis/投资逻辑，规范页) + STOCK(仅承载代码/行情) 两个实体，
// 名字近乎重复（「贵州茅台」+「贵州茅台(600519)」）。搜索「贵州茅台」会同时命中两条，
// 且 STOCK 名里已含代码、前端又补 ticker 列 → 显示成「贵州茅台(600519)(600519)」双代码，
// 用户还得纠结点哪条。COMPANY 页才是规范页（有 thesis，且已从其 STOCK 取代码显示行情）。
//
// 规则：把 COMPANY 与其发行 STOCK 合并成一条 COMPANY（代码取自 STOCK），按代码搜到 STOCK 也归到
// 其 COMPANY；孤儿 STOCK（无对应 COMPANY）保留。SECTOR/PERSON 原样返回。

import type { EntityType } from "../../generated/prisma";

export type SearchHit = {
  id: string;
  name: string;
  type: EntityType; // SECTOR | COMPANY | STOCK | PERSON
  ticker: string | null;
};

/** COMPANY --ISSUES--> STOCK 关系（用于把 STOCK 归并到 COMPANY，并给 COMPANY 补代码显示）。 */
export type IssueLink = {
  companyId: string;
  company: SearchHit;
  stockId: string;
  stockTicker: string | null;
};

export function dedupeSearchResults(
  raw: SearchHit[],
  links: IssueLink[],
): SearchHit[] {
  const linkByStock = new Map(links.map((l) => [l.stockId, l]));
  const tickerByCompany = new Map(links.map((l) => [l.companyId, l.stockTicker]));
  const seen = new Map<string, SearchHit>();

  for (const e of raw) {
    if (e.type === "STOCK") {
      const link = linkByStock.get(e.id);
      if (link) {
        // 归并到 COMPANY（代码优先用 STOCK 自身的）
        const ticker = e.ticker ?? link.stockTicker ?? null;
        const existing = seen.get(link.companyId);
        if (existing) {
          if (!existing.ticker && ticker) existing.ticker = ticker;
        } else {
          seen.set(link.companyId, { ...link.company, ticker });
        }
        continue;
      }
      // 孤儿 STOCK：无对应 COMPANY，原样保留
    }

    const existing = seen.get(e.id);
    if (existing) {
      // COMPANY 已在（可能由其 STOCK 先归并进来），补代码
      if (e.type === "COMPANY" && !existing.ticker) {
        const t = e.ticker ?? tickerByCompany.get(e.id) ?? null;
        if (t) existing.ticker = t;
      }
      continue;
    }
    // COMPANY 直接命中：补上其发行股票的代码用于显示
    const ticker =
      e.type === "COMPANY"
        ? e.ticker ?? tickerByCompany.get(e.id) ?? null
        : e.ticker;
    seen.set(e.id, { ...e, ticker });
  }

  return [...seen.values()];
}
