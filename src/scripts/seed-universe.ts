import { PrismaClient } from "../../generated/prisma";
import { exchangeFromCode, isSeedableStock, hasTempPrefix } from "../lib/universe";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 按市值 desc 分页抓前 n 只 A 股（东方财富 clist）。单页 pz=200，逐页翻到够数。
 * 东财 push2 会对密集请求限流（返回空/非 200）——所以逐页限速 + 失败重试，
 * 且**不再整体抛错**：某页始终失败就带着已抓到的结果继续（宁可少抓也别整轮炸掉）。
 */
async function fetchTopAshare(n: number): Promise<{ code: string; name: string }[]> {
  const out: { code: string; name: string }[] = [];
  // 东财 clist 服务端每页实际最多返回 100 条（传 pz=200 也只给 100）——
  // 原来按 pz=200 算页数，导致实际只抓到 SEED_TOP_N 的一半（TOP_N=1000 只进了 ~500 只）。
  const pz = 100;
  const pages = Math.ceil(n / pz);
  for (let pn = 1; pn <= pages; pn++) {
    const url =
      `https://push2.eastmoney.com/api/qt/clist/get?pn=${pn}&pz=${pz}&po=1&np=1` +
      `&fid=f20&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048&fields=f12,f14`;
    let diff: { f12: string; f14: string }[] = [];
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": UA, Referer: "https://quote.eastmoney.com" },
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
          const j = (await res.json()) as {
            data?: { diff?: { f12: string; f14: string }[] };
          };
          diff = j.data?.diff ?? [];
          if (diff.length > 0) break;
        }
      } catch {
        // 网络/超时 → 退避重试
      }
      if (attempt < 4) await sleep(800 * attempt); // 被限流时退避
    }
    if (diff.length === 0) {
      console.log(`  ! pn=${pn} 连续重试仍无数据（疑似限流），带着已抓 ${out.length} 只继续`);
      break;
    }
    out.push(...diff.map((d) => ({ code: d.f12, name: d.f14 })));
    console.log(`  pn=${pn} +${diff.length} → 累计 ${out.length}`);
    if (out.length >= n) break;
    await sleep(400); // 逐页限速，避免触发限流
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
  let tempPrefixed = 0;
  for (const t of top) {
    // 东财把短名 pad 成「五 粮 液」，去掉内部空白再入库——否则与巨潮 hint/新闻标题里的「五粮液」对不上，绑不上公告。
    t.name = t.name.replace(/\s+/g, "");
    if (!isSeedableStock(t.name)) {
      skipped++;
      continue;
    }
    // 除权除息日抓到的名字是「XD华电新」——带前缀且被截断，真名当天无源可还原。
    // 用它建实体会①新建重复公司②进词典后永远绑不上资讯③真名搜不到。故当天跳过，次日正常名再收。
    if (hasTempPrefix(t.name)) {
      tempPrefixed++;
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
    let stock = await db.entity.findFirst({
      where: { type: "STOCK", ticker: t.code },
    });
    if (!stock) {
      stock = await db.entity.create({
        data: {
          type: "STOCK",
          name: `${t.name}(${t.code})`,
          ticker: t.code,
          exchange: exchangeFromCode(t.code),
        },
      });
      newStk++;
    }
    // 股票已存在时也要补 ISSUES 关系——否则公司改名/除息日变名会新建一个 COMPANY
    // 却永远没有代码绑定（孤儿公司：搜不到行情、拿不到公告、报告里显示「实体不完整」）。
    // 但该股票若已被别的公司认领，就不再重复挂（避免两家公司发行同一只股票）。
    const claimed = await db.entityRelation.findFirst({
      where: { toId: stock.id, type: "ISSUES" },
      select: { fromId: true },
    });
    if (!claimed) {
      await db.entityRelation
        .create({ data: { fromId: company.id, toId: stock.id, type: "ISSUES" } })
        .catch(() => undefined);
    }
  }

  const total = await db.entity.count();
  console.log(
    `seed-universe(TOP_N=${TOP_N}): +${newSectors} 板块, +${newCo} 公司, +${newStk} 股票, 跳过 ${skipped}(ETF/ST/退市) + ${tempPrefixed}(除权除息临时名,次日再收) → 实体总数 ${total}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
