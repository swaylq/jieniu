// 热门板块成分股覆盖（张楚寒/GPT 反馈 2026-07-13：先覆盖最热门板块最火的股票，约一两百只）。
//
// 对每个 curated 热门板块（src/lib/hot-universe.ts）：抓东方财富板块成分股（按市值 desc 取前
// cap 只 = 板块里「最火」的龙头），把它们 classify 进 SECTOR（BELONGS_TO 关系），从而让
// 「热门板块 × 热门股」成为一手可发现的数据。幂等：已有股票按 ticker 复用、关系存在则跳过。

import { PrismaClient } from "../../generated/prisma";
import { HOT_SECTORS, dedupeHotStocks, type HotStockRow } from "../lib/hot-universe";
import { exchangeFromCode, isSeedableStock } from "../lib/universe";

const db = new PrismaClient();
const UA = "Mozilla/5.0 (jieniu-ingest)";

/** 抓某板块前 cap 只成分股（按市值 f20 desc）。f12=代码, f14=名称。 */
async function fetchBoardConstituents(
  board: string,
  cap: number,
): Promise<{ code: string; name: string }[]> {
  const url =
    `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=${cap}&po=1&np=1` +
    `&fid=f20&fs=b:${board}&fields=f12,f14`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
  if (!res.ok) throw new Error(`board ${board} → ${res.status}`);
  const j = (await res.json()) as {
    data?: { diff?: { f12: string; f14: string }[] };
  };
  return (j.data?.diff ?? []).map((d) => ({
    code: d.f12,
    // 东方财富把 3 字名 pad 成「五 粮 液」，去掉内部空白再入库。
    name: d.f14.replace(/\s+/g, ""),
  }));
}

/** 确保 company→to 存在某类型关系（幂等）。 */
async function ensureRelation(
  fromId: string,
  toId: string,
  type: "ISSUES" | "BELONGS_TO",
) {
  const existing = await db.entityRelation.findFirst({
    where: { fromId, toId, type },
    select: { id: true },
  });
  if (existing) return false;
  await db.entityRelation.create({ data: { fromId, toId, type } });
  return true;
}

async function main() {
  const allRows: HotStockRow[] = [];
  let newSectors = 0;
  let newCompanies = 0;
  let newStocks = 0;
  let newBelongs = 0;

  for (const s of HOT_SECTORS) {
    // 1) 确保 SECTOR 实体（新板块如 算力/光模块/机器人 在此创建）。
    let sector = await db.entity.findFirst({
      where: { type: "SECTOR", name: s.name },
      select: { id: true },
    });
    if (!sector) {
      sector = await db.entity.create({
        data: { type: "SECTOR", name: s.name, shortName: s.name, aliases: s.aliases ?? [] },
        select: { id: true },
      });
      newSectors++;
    }

    // 2) 抓成分股。
    let constituents: { code: string; name: string }[] = [];
    try {
      constituents = await fetchBoardConstituents(s.board, s.cap);
    } catch (e) {
      console.error(`  [${s.name}] 成分股抓取失败:`, (e as Error).message);
      continue;
    }

    let secBelongs = 0;
    for (const c of constituents) {
      if (!isSeedableStock(c.name)) continue;

      // 3) 已有股票按 ticker 复用，并沿 ISSUES 找回其 COMPANY（避免按名建重复实体）。
      let company: { id: string } | null = null;
      const stock = await db.entity.findFirst({
        where: { type: "STOCK", ticker: c.code },
        select: { id: true },
      });
      if (stock) {
        const issuer = await db.entityRelation.findFirst({
          where: { toId: stock.id, type: "ISSUES", from: { type: "COMPANY" } },
          select: { from: { select: { id: true } } },
        });
        company = issuer?.from ?? null;
      }

      // 4) 新股票 / 孤儿股票：补建 COMPANY + STOCK + ISSUES。
      if (!company) {
        company =
          (await db.entity.findFirst({
            where: { type: "COMPANY", name: c.name },
            select: { id: true },
          })) ?? null;
        if (!company) {
          company = await db.entity.create({
            data: { type: "COMPANY", name: c.name, shortName: c.name },
            select: { id: true },
          });
          newCompanies++;
        }
        let stk = stock;
        if (!stk) {
          stk = await db.entity.create({
            data: {
              type: "STOCK",
              name: `${c.name}(${c.code})`,
              ticker: c.code,
              exchange: exchangeFromCode(c.code),
            },
            select: { id: true },
          });
          newStocks++;
        }
        await ensureRelation(company.id, stk.id, "ISSUES");
      }

      // 5) classify：company BELONGS_TO sector（核心新数据）。
      if (await ensureRelation(company.id, sector.id, "BELONGS_TO")) {
        newBelongs++;
        secBelongs++;
      }
      allRows.push({ ticker: c.code, name: c.name, sector: s.name });
    }
    console.log(`  [${s.name}] ${s.board}: ${constituents.length} 成分股 → +${secBelongs} 归类`);
  }

  const unique = dedupeHotStocks(allRows);
  console.log(
    `\nseed-hot-sectors: +${newSectors} 板块, +${newCompanies} 公司, +${newStocks} 股票, ` +
      `+${newBelongs} 归类关系 → 覆盖唯一热门股 ${unique.length} 只（跨 ${HOT_SECTORS.length} 个热门板块）`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
