// 修实体名的东财/新浪临时前缀（XD 除息 / DR 除权除息 / N 新股首日 …）——与 fix-padded-names.ts
// 同一类 bug：seed 当天恰逢除息，抓到的名字成了「XD华电新」（还被截断），导致资讯/公告里的
// 「华电新能」匹配不上该实体 → 公司页全空。
//
// 做法：命中前缀的实体 → 用实时行情取回规范名（新浪主源）→ 改名 → 定向回补巨潮公告。
// 守卫：取回的名字若仍带前缀（如真的就叫「S佳通」）或取不到，则跳过不动。

import { PrismaClient } from "../../generated/prisma";
import { fetchQuote } from "../server/quote";
import { ingestSource } from "../server/ingest/runner";
import { cninfoForCodes } from "../server/ingest/sources/cninfo";

const db = new PrismaClient();

/** 东财/新浪临时前缀：XD 除息、DR 除权除息、N 新股首日、R/S 历史标记。后接中文才算。 */
const PREFIX = /^(XD|DR|N|R|S)[一-龥]/;

async function main() {
  const ents = await db.entity.findMany({
    where: { type: { in: ["COMPANY", "STOCK"] } },
    select: { id: true, type: true, name: true, ticker: true },
  });
  const hits = ents.filter((e) => PREFIX.test(e.name));
  console.log(`命中 ${hits.length} 个带前缀实体`);

  // 每个实体解析出 ticker：STOCK 自带；COMPANY 走 ISSUES→STOCK。
  const tickerByEntity = new Map<string, string>();
  for (const e of hits) {
    if (e.ticker) {
      tickerByEntity.set(e.id, e.ticker);
      continue;
    }
    const iss = await db.entityRelation.findFirst({
      where: { fromId: e.id, type: "ISSUES", to: { type: "STOCK" } },
      select: { to: { select: { ticker: true } } },
    });
    if (iss?.to.ticker) tickerByEntity.set(e.id, iss.to.ticker);
  }

  // 每个 ticker 只拉一次行情拿规范名
  const codes = [...new Set([...tickerByEntity.values()])];
  const cleanByCode = new Map<string, string>();
  for (const code of codes) {
    const q = await fetchQuote(code);
    const name = q?.name?.replace(/\s+/g, "") ?? "";
    if (!name) {
      console.log(`  ✗ ${code}：取不到行情名，跳过`);
      continue;
    }
    if (PREFIX.test(name)) {
      console.log(`  – ${code}：行情名仍带前缀「${name}」(可能本就如此)，跳过`);
      continue;
    }
    cleanByCode.set(code, name);
    console.log(`  ✓ ${code} → 规范名「${name}」`);
  }

  let fixed = 0;
  for (const e of hits) {
    const code = tickerByEntity.get(e.id);
    const clean = code ? cleanByCode.get(code) : undefined;
    if (!code || !clean) continue;
    const nextName = e.type === "STOCK" ? `${clean}(${code})` : clean;
    if (nextName === e.name) continue;
    await db.entity.update({
      where: { id: e.id },
      data:
        e.type === "COMPANY"
          ? { name: nextName, shortName: clean }
          : { name: nextName },
    });
    console.log(`  改名 [${e.type}] "${e.name}" → "${nextName}"`);
    fixed++;
  }
  console.log(`\n改名完成：${fixed} 个实体`);

  // 定向回补公告（与 add-stocks.ts 同路径，targeted 不污染）
  const fixedCodes = [...cleanByCode.keys()];
  if (fixedCodes.length > 0) {
    const r = await ingestSource(db, cninfoForCodes(fixedCodes));
    console.log(`公告回补: fetched=${r.fetched} inserted=${r.inserted} tagged=${r.tagged}`);
  }

  // ── 通用修复（与前缀无关，幂等）：历史上有些资讯只绑到了 STOCK、没绑到 COMPANY，
  // 导致公司页「看着是空的」。把这类公司的 STOCK 资讯补绑到 COMPANY（同 fix-padded-names.ts）。
  // 只处理「自身 0 条、但其 STOCK 有资讯」的公司——targeted，不会乱扩绑定。
  const blankCompanies = await db.entity.findMany({
    where: { type: "COMPANY", news: { none: {} } },
    select: {
      id: true,
      name: true,
      relFrom: { where: { type: "ISSUES", to: { type: "STOCK" } }, select: { toId: true } },
    },
  });
  let rebinds = 0;
  let rescued = 0;
  for (const c of blankCompanies) {
    const stockId = c.relFrom[0]?.toId;
    if (!stockId) continue;
    const stockNews = await db.newsEntity.findMany({
      where: { entityId: stockId },
      select: { newsId: true },
    });
    if (stockNews.length === 0) continue;
    const r = await db.newsEntity.createMany({
      data: stockNews.map((n) => ({ newsId: n.newsId, entityId: c.id })),
      skipDuplicates: true,
    });
    if (r.count > 0) {
      rebinds += r.count;
      rescued++;
      console.log(`  补绑 ${c.name}: +${r.count} 条(原只绑在 STOCK 上)`);
    }
  }
  console.log(`\nSTOCK→COMPANY 补绑：救回 ${rescued} 家公司、共 ${rebinds} 条资讯`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
