import { PrismaClient } from "../../generated/prisma";
import { exchangeFromCode, isSeedableStock } from "../lib/universe";

const db = new PrismaClient();
const UA = "Mozilla/5.0 (jieniu-ingest)";
// 热门股宇宙规模（按市值 desc 取前 N），env 可覆盖。1000 ≈ 沪深300+中证500+，覆盖主流关注个股。
const TOP_N = Number(process.env.SEED_TOP_N ?? 1000);

// 主要板块（半导体已存在则幂等跳过）。
const SECTORS: { name: string; aliases: string[] }[] = [
  { name: "半导体", aliases: ["芯片", "集成电路", "IC"] },
  { name: "新能源", aliases: ["锂电", "动力电池"] },
  { name: "光伏", aliases: ["太阳能"] },
  { name: "储能", aliases: [] },
  { name: "人工智能", aliases: ["AI", "算力", "大模型"] },
  { name: "消费电子", aliases: ["3C"] },
  { name: "白酒", aliases: ["酿酒"] },
  { name: "医药", aliases: ["创新药", "医药生物"] },
  { name: "银行", aliases: ["银行板块", "银行股", "银行业"] },
  { name: "券商", aliases: ["证券公司", "证券板块"] },
  { name: "军工", aliases: ["国防"] },
  { name: "汽车", aliases: ["整车", "新能源车"] },
  { name: "房地产", aliases: ["地产"] },
];

/** 按市值 desc 分页抓前 n 只 A 股（东方财富 clist）。单页 pz=200，逐页翻到够数。 */
async function fetchTopAshare(n: number): Promise<{ code: string; name: string }[]> {
  const out: { code: string; name: string }[] = [];
  const pz = 200;
  const pages = Math.ceil(n / pz);
  for (let pn = 1; pn <= pages; pn++) {
    const url =
      `https://push2.eastmoney.com/api/qt/clist/get?pn=${pn}&pz=${pz}&po=1&np=1` +
      `&fid=f20&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048&fields=f12,f14`;
    const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
    if (!res.ok) throw new Error(`clist ${res.status} @pn${pn}`);
    const j = (await res.json()) as {
      data?: { diff?: { f12: string; f14: string }[] };
    };
    const diff = j.data?.diff ?? [];
    if (diff.length === 0) break;
    out.push(...diff.map((d) => ({ code: d.f12, name: d.f14 })));
    if (out.length >= n) break;
  }
  return out.slice(0, n);
}

async function main() {
  let newSectors = 0;
  for (const s of SECTORS) {
    const existing = await db.entity.findFirst({
      where: { type: "SECTOR", name: s.name },
    });
    if (existing) continue;
    await db.entity.create({
      data: { type: "SECTOR", name: s.name, shortName: s.name, aliases: s.aliases },
    });
    newSectors++;
  }

  const top = await fetchTopAshare(TOP_N);
  let newCo = 0;
  let newStk = 0;
  let skipped = 0;
  for (const t of top) {
    // 东财把短名 pad 成「五 粮 液」，去掉内部空白再入库——否则与巨潮 hint/新闻标题里的「五粮液」对不上，绑不上公告。
    t.name = t.name.replace(/\s+/g, "");
    if (!isSeedableStock(t.name)) {
      skipped++;
      continue;
    }
    let company = await db.entity.findFirst({
      where: { type: "COMPANY", name: t.name },
    });
    if (!company) {
      company = await db.entity.create({
        data: { type: "COMPANY", name: t.name, shortName: t.name },
      });
      newCo++;
    }
    const stock = await db.entity.findFirst({
      where: { type: "STOCK", ticker: t.code },
    });
    if (!stock) {
      const created = await db.entity.create({
        data: {
          type: "STOCK",
          name: `${t.name}(${t.code})`,
          ticker: t.code,
          exchange: exchangeFromCode(t.code),
        },
      });
      newStk++;
      await db.entityRelation
        .create({ data: { fromId: company.id, toId: created.id, type: "ISSUES" } })
        .catch(() => undefined);
    }
  }

  const total = await db.entity.count();
  console.log(
    `seed-universe(TOP_N=${TOP_N}): +${newSectors} 板块, +${newCo} 公司, +${newStk} 股票, 跳过 ${skipped}(ETF/ST/退市) → 实体总数 ${total}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
