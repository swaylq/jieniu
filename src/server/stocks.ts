// 加股的共享服务端逻辑（backlog #4 自助加股 + add-stocks.ts 脚本共用）。
// 注意：用相对导入，且**不**引入 fetchQuote（它经 ~/lib/quote 走别名，tsx 脚本不解析 ~）。
// 行情校验只在路由（Next 上下文）做；本模块只管东财代码解析 + 幂等建实体。

import type { Prisma, PrismaClient } from "../../generated/prisma";
import { normalizeStockName } from "../lib/add-stock";
import { exchangeFromCode } from "../lib/universe";

const UA = "Mozilla/5.0 (jieniu-ingest)";

type StockDb = Pick<PrismaClient, "entity" | "entityRelation">;

/** 东财 suggest：股票名 → A股代码（沪 MktNum=1 / 深=0）。失败/无匹配返回 null。北交所走代码直填。 */
export async function resolveCodeByName(name: string): Promise<string | null> {
  const url =
    `https://searchadapter.eastmoney.com/api/suggest/get?input=${encodeURIComponent(name)}` +
    `&type=14&count=8&token=D43BF722C8E33BDC906FB84D85E326E8`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      QuotationCodeTable?: { Data?: { Code: string; Name: string; MktNum: string }[] };
    };
    const arr = j.QuotationCodeTable?.Data ?? [];
    const ashare = arr.filter((x) => x.MktNum === "1" || x.MktNum === "0");
    const hit = ashare.find((x) => x.Name === name) ?? ashare[0];
    return hit?.Code ?? null;
  } catch {
    return null;
  }
}

/**
 * 建 COMPANY+STOCK+ISSUES（幂等，按 ticker 复用已有股票、按名字复用已有公司）。返回 { companyId, created }。
 * created=true 表示本次新建了 COMPANY（自助加股用于打 meta 来源标记）。
 */
export async function ensureStockEntities(
  db: StockDb,
  rawName: string,
  code: string,
  meta?: Prisma.InputJsonValue,
): Promise<{ companyId: string; created: boolean }> {
  const name = normalizeStockName(rawName);
  let stock = await db.entity.findFirst({
    where: { type: "STOCK", ticker: code },
    select: { id: true },
  });
  let companyRow: { id: string } | null = null;
  if (stock) {
    const iss = await db.entityRelation.findFirst({
      where: { toId: stock.id, type: "ISSUES", from: { type: "COMPANY" } },
      select: { from: { select: { id: true } } },
    });
    companyRow = iss?.from ?? null;
  }
  let created = false;
  companyRow ??= await db.entity.findFirst({
    where: { type: "COMPANY", name },
    select: { id: true },
  });
  if (!companyRow) {
    companyRow = await db.entity.create({
      data: { type: "COMPANY", name, shortName: name, ...(meta ? { meta } : {}) },
      select: { id: true },
    });
    created = true;
  }
  stock ??= await db.entity.create({
    data: {
      type: "STOCK",
      name: `${name}(${code})`,
      ticker: code,
      exchange: exchangeFromCode(code),
    },
    select: { id: true },
  });
  const rel = await db.entityRelation.findFirst({
    where: { fromId: companyRow.id, toId: stock.id, type: "ISSUES" },
    select: { id: true },
  });
  if (!rel) {
    await db.entityRelation.create({
      data: { fromId: companyRow.id, toId: stock.id, type: "ISSUES" },
    });
  }
  return { companyId: companyRow.id, created };
}
