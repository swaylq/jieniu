// 全行业分类（sway 2026-07-26：别再重点覆盖，全部覆盖）——给全部 A 股按东财所属行业(f100)
// 建行业板块 + STOCK→行业 BELONGS_TO，让首页/发现页能「全部覆盖」而非只 130 只热门。
// f100 形如「银行Ⅱ/白酒Ⅱ/电池/半导体」——去罗马数字后缀归一（银行Ⅱ→银行），与已有主题板块同名即复用。
// 幂等：板块按名先查后建；BELONGS_TO 先查后建。走 push2delay（push2 封锁）。
import { PrismaClient } from "../../generated/prisma";

const db = new PrismaClient();
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const FS = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 去掉行业名尾部的罗马数字层级（银行Ⅱ→银行），与主题板块对齐。 */
function normIndustry(s: string): string {
  return s.replace(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+$/u, "").trim();
}

async function fetchAll(): Promise<{ code: string; industry: string }[]> {
  const out: { code: string; industry: string }[] = [];
  const pz = 100;
  for (let pn = 1; pn <= 60; pn++) {
    let diff: { f12: string; f100: string }[] = [];
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const r = await fetch(
          `https://push2delay.eastmoney.com/api/qt/clist/get?pn=${pn}&pz=${pz}&po=1&np=1&fid=f20&fs=${FS}&fields=f12,f100`,
          { headers: { "User-Agent": UA, Referer: "https://quote.eastmoney.com" }, signal: AbortSignal.timeout(15000) },
        );
        const j = (await r.json()) as { data?: { diff?: { f12: string; f100: string }[] } };
        diff = j.data?.diff ?? [];
        break;
      } catch {
        if (attempt === 4) diff = [];
        await sleep(800);
      }
    }
    if (diff.length === 0) break;
    for (const d of diff) {
      const industry = normIndustry(d.f100 ?? "");
      if (d.f12 && industry) out.push({ code: d.f12, industry });
    }
    await sleep(200);
  }
  return out;
}

async function main() {
  const rows = await fetchAll();
  console.log(`clist 拿到 ${rows.length} 只带行业`);
  const industries = [...new Set(rows.map((r) => r.industry))];
  console.log(`共 ${industries.length} 个行业`);

  // 行业板块（同名复用，否则新建）
  const secId = new Map<string, string>();
  for (const name of industries) {
    let sec = await db.entity.findFirst({ where: { type: "SECTOR", name } });
    sec ??= await db.entity.create({
      data: { type: "SECTOR", name, shortName: name, aliases: [] },
    });
    secId.set(name, sec.id);
  }

  // STOCK → 行业 BELONGS_TO
  const stocks = await db.entity.findMany({
    where: { type: "STOCK", ticker: { not: null } },
    select: { id: true, ticker: true },
  });
  const stockByCode = new Map(stocks.map((s) => [s.ticker!, s.id]));
  // 已有的 STOCK BELONGS_TO 边（避免重复建）
  const existing = new Set(
    (
      await db.entityRelation.findMany({
        where: { type: "BELONGS_TO", from: { type: "STOCK" } },
        select: { fromId: true, toId: true },
      })
    ).map((r) => `${r.fromId}|${r.toId}`),
  );

  let linked = 0;
  for (const { code, industry } of rows) {
    const sid = stockByCode.get(code);
    const secid = secId.get(industry);
    if (!sid || !secid) continue;
    if (existing.has(`${sid}|${secid}`)) continue;
    await db.entityRelation
      .create({ data: { fromId: sid, toId: secid, type: "BELONGS_TO" } })
      .catch(() => undefined);
    existing.add(`${sid}|${secid}`);
    linked++;
  }
  const classified = new Set(rows.map((r) => stockByCode.get(r.code)).filter(Boolean)).size;
  console.log(`seed-industries: +${linked} 条 STOCK→行业, 覆盖 ${classified}/${stocks.length} 只股`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
