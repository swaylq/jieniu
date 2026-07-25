// 美股 seed（sway 2026-07-24：增加美股内容深度）——中国投资者最关注的美股大盘科技 + 中概股。
// 建 COMPANY+STOCK（exchange=US，ticker=美股代码）+ ISSUES + BELONGS_TO 板块；name=中文名、
// aliases=[英文名]，让中/英文提及都能被 matchEntities 挂上。个股新闻走 个股资讯 搜中文名（已验证）。
// 幂等：按名字/ticker 先查后建，重跑只补新的。
import { PrismaClient } from "../../generated/prisma";

const db = new PrismaClient();

type US = { cn: string; en: string; ticker: string; sector: string };
// 归入现有板块（半导体/人工智能/消费电子/汽车）+ 新建「中概股」。
const US_STOCKS: US[] = [
  // 半导体
  { cn: "英伟达", en: "NVIDIA", ticker: "NVDA", sector: "半导体" },
  { cn: "AMD", en: "AMD", ticker: "AMD", sector: "半导体" },
  { cn: "英特尔", en: "Intel", ticker: "INTC", sector: "半导体" },
  { cn: "台积电", en: "TSMC", ticker: "TSM", sector: "半导体" },
  { cn: "博通", en: "Broadcom", ticker: "AVGO", sector: "半导体" },
  { cn: "高通", en: "Qualcomm", ticker: "QCOM", sector: "半导体" },
  { cn: "美光", en: "Micron", ticker: "MU", sector: "半导体" },
  { cn: "阿斯麦", en: "ASML", ticker: "ASML", sector: "半导体" },
  { cn: "应用材料", en: "Applied Materials", ticker: "AMAT", sector: "半导体" },
  { cn: "泛林", en: "Lam Research", ticker: "LRCX", sector: "半导体" },
  { cn: "德州仪器", en: "Texas Instruments", ticker: "TXN", sector: "半导体" },
  { cn: "安谋", en: "Arm", ticker: "ARM", sector: "半导体" },
  // 人工智能 / 算力
  { cn: "微软", en: "Microsoft", ticker: "MSFT", sector: "人工智能" },
  { cn: "谷歌", en: "Google", ticker: "GOOGL", sector: "人工智能" },
  { cn: "Meta", en: "Meta", ticker: "META", sector: "人工智能" },
  { cn: "亚马逊", en: "Amazon", ticker: "AMZN", sector: "人工智能" },
  { cn: "甲骨文", en: "Oracle", ticker: "ORCL", sector: "人工智能" },
  { cn: "Palantir", en: "Palantir", ticker: "PLTR", sector: "人工智能" },
  { cn: "超微电脑", en: "Super Micro", ticker: "SMCI", sector: "人工智能" },
  // 消费电子
  { cn: "苹果", en: "Apple", ticker: "AAPL", sector: "消费电子" },
  // 汽车
  { cn: "特斯拉", en: "Tesla", ticker: "TSLA", sector: "汽车" },
  // 中概股
  { cn: "阿里巴巴", en: "Alibaba", ticker: "BABA", sector: "中概股" },
  { cn: "拼多多", en: "PDD", ticker: "PDD", sector: "中概股" },
  { cn: "京东", en: "JD.com", ticker: "JD", sector: "中概股" },
  { cn: "百度", en: "Baidu", ticker: "BIDU", sector: "中概股" },
  { cn: "网易", en: "NetEase", ticker: "NTES", sector: "中概股" },
  { cn: "蔚来", en: "NIO", ticker: "NIO", sector: "中概股" },
  { cn: "小鹏汽车", en: "XPeng", ticker: "XPEV", sector: "中概股" },
  { cn: "理想汽车", en: "Li Auto", ticker: "LI", sector: "中概股" },
  { cn: "富途", en: "Futu", ticker: "FUTU", sector: "中概股" },
  { cn: "携程", en: "Trip.com", ticker: "TCOM", sector: "中概股" },
];

async function main() {
  // 板块（现有的复用，中概股新建）。
  const sectorNames = [...new Set(US_STOCKS.map((s) => s.sector))];
  const sectorId = new Map<string, string>();
  for (const name of sectorNames) {
    let sec = await db.entity.findFirst({ where: { type: "SECTOR", name } });
    sec ??= await db.entity.create({
      data: { type: "SECTOR", name, shortName: name, aliases: [] },
    });
    sectorId.set(name, sec.id);
  }

  let newCo = 0;
  let newStk = 0;
  for (const s of US_STOCKS) {
    let company = await db.entity.findFirst({
      where: { type: "COMPANY", name: s.cn },
    });
    if (!company) {
      company = await db.entity.create({
        data: { type: "COMPANY", name: s.cn, shortName: s.cn, aliases: [s.en] },
      });
      newCo++;
    }
    let stock = await db.entity.findFirst({
      where: { type: "STOCK", ticker: s.ticker },
    });
    if (!stock) {
      stock = await db.entity.create({
        data: {
          type: "STOCK",
          name: `${s.cn}(${s.ticker})`,
          shortName: s.cn,
          aliases: [s.en],
          ticker: s.ticker,
          exchange: "US",
        },
      });
      newStk++;
    }
    // COMPANY issues STOCK
    const issued = await db.entityRelation.findFirst({
      where: { toId: stock.id, type: "ISSUES" },
    });
    if (!issued) {
      await db.entityRelation
        .create({ data: { fromId: company.id, toId: stock.id, type: "ISSUES" } })
        .catch(() => undefined);
    }
    // STOCK belongs_to SECTOR
    const sid = sectorId.get(s.sector)!;
    const belongs = await db.entityRelation.findFirst({
      where: { fromId: stock.id, toId: sid, type: "BELONGS_TO" },
    });
    if (!belongs) {
      await db.entityRelation
        .create({ data: { fromId: stock.id, toId: sid, type: "BELONGS_TO" } })
        .catch(() => undefined);
    }
  }

  const usTotal = await db.entity.count({ where: { type: "STOCK", exchange: "US" } });
  console.log(
    `seed-us: +${newCo} 公司, +${newStk} 股票（含新建中概股板块）→ 美股实体总数 ${usTotal}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
