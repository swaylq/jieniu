// 覆盖率验收报告：用真实数据回答「到底覆盖了多少、有多少是空的、为什么空」。
// 用法：DATABASE_URL=... npx tsx src/scripts/coverage-report.ts
// 不改任何数据，只读统计。

import { PrismaClient } from "../../generated/prisma";
import { HOT_SECTOR_NAMES } from "../lib/hot-universe";

const db = new PrismaClient();
const DAY = 24 * 60 * 60 * 1000;

async function main() {
  const now = Date.now();
  const d7 = new Date(now - 7 * DAY);
  const d30 = new Date(now - 30 * DAY);

  const [companies, stocks, news, withNews, w7, w30, withThesis, withStock] =
    await Promise.all([
      db.entity.count({ where: { type: "COMPANY" } }),
      db.entity.count({ where: { type: "STOCK" } }),
      db.newsItem.count(),
      db.entity.count({ where: { type: "COMPANY", news: { some: {} } } }),
      db.entity.count({
        where: { type: "COMPANY", news: { some: { news: { publishedAt: { gte: d7 } } } } },
      }),
      db.entity.count({
        where: { type: "COMPANY", news: { some: { news: { publishedAt: { gte: d30 } } } } },
      }),
      db.entity.count({ where: { type: "COMPANY", thesis: { isNot: null } } }),
      db.entity.count({
        where: { type: "COMPANY", relFrom: { some: { type: "ISSUES", to: { type: "STOCK" } } } },
      }),
    ]);

  const pct = (a: number, b: number) => (b === 0 ? "0%" : `${((a / b) * 100).toFixed(1)}%`);

  console.log("=== 解牛覆盖率验收报告 ===");
  console.log(`生成时间: ${new Date(now).toISOString()}`);
  console.log("");
  console.log("【入库规模】");
  console.log(`  公司(COMPANY)实体: ${companies}`);
  console.log(`  股票(STOCK)实体:   ${stocks}`);
  console.log(`  资讯条目总数:      ${news}`);
  console.log("");
  console.log("【基础资料完整率】");
  console.log(`  有绑定股票代码: ${withStock}/${companies} (${pct(withStock, companies)})`);
  console.log("");

  // thesis 只对「重点覆盖的热门股宇宙」生成（聚焦策略 + 省token铁律④）——
  // 拿 thesis 除以全部 508 家是**误导性指标**（会显示 ~26% 像是大缺口，实则长尾本就不生成）。
  // 有意义的口径：热门宇宙内的 thesis 覆盖率。
  const hotSectors = await db.entity.findMany({
    where: { type: "SECTOR", name: { in: [...HOT_SECTOR_NAMES] } },
    select: { id: true },
  });
  const hotMembers = await db.entityRelation.findMany({
    where: {
      type: "BELONGS_TO",
      toId: { in: hotSectors.map((s) => s.id) },
      from: { type: "COMPANY" },
    },
    select: { fromId: true },
  });
  const hotIds = [...new Set(hotMembers.map((m) => m.fromId))];
  const hotWithThesis = await db.entity.count({
    where: { id: { in: hotIds }, thesis: { isNot: null } },
  });
  console.log("【投资逻辑 thesis 覆盖】(只对重点覆盖的热门股生成——长尾不生成是设计)");
  console.log(`  ★ 热门宇宙内: ${hotWithThesis}/${hotIds.length} (${pct(hotWithThesis, hotIds.length)})  ← 有意义的口径`);
  console.log(`    全库(含长尾)供参考: ${withThesis}/${companies} (${pct(withThesis, companies)})，长尾无 thesis 属预期`);
  console.log("");
  console.log("【有效信息覆盖】");
  console.log(`  有任意资讯:    ${withNews}/${companies} (${pct(withNews, companies)})`);
  console.log(`  近30天有资讯:  ${w30}/${companies} (${pct(w30, companies)})`);
  console.log(`  近7天有资讯:   ${w7}/${companies} (${pct(w7, companies)})`);
  console.log(`  ★ 完全空白:    ${companies - withNews} 家 (${pct(companies - withNews, companies)})`);
  console.log("");

  // 空白公司及原因
  const blanks = await db.entity.findMany({
    where: { type: "COMPANY", news: { none: {} } },
    select: {
      name: true,
      relFrom: { where: { type: "ISSUES" }, select: { to: { select: { ticker: true } } } },
    },
    take: 15,
  });
  if (blanks.length > 0) {
    console.log("【空白公司抽样(最多15家) + 原因判断】");
    for (const b of blanks) {
      const ticker = b.relFrom[0]?.to.ticker ?? null;
      const reason = ticker ? "有代码但窗口期内无公告/资讯命中" : "无绑定股票代码(实体不完整)";
      console.log(`  ${b.name}${ticker ? `(${ticker})` : ""} — ${reason}`);
    }
    console.log("");
  }

  // 资讯来源与新鲜度
  const bySource = await db.newsItem.groupBy({
    by: ["sourceId"],
    _count: { _all: true },
    orderBy: { _count: { sourceId: "desc" } },
  });
  const sources = await db.source.findMany({ select: { id: true, name: true, tier: true } });
  const nameById = new Map(sources.map((s) => [s.id, `${s.name}(${s.tier})`]));
  console.log("【各数据源入库量】");
  for (const s of bySource) {
    console.log(`  ${nameById.get(s.sourceId) ?? s.sourceId}: ${s._count._all}`);
  }
  console.log("");

  const [n24, n7d] = await Promise.all([
    db.newsItem.count({ where: { createdAt: { gte: new Date(now - DAY) } } }),
    db.newsItem.count({ where: { createdAt: { gte: d7 } } }),
  ]);
  console.log("【抓取活跃度】");
  console.log(`  近24小时新入库: ${n24}`);
  console.log(`  近7天新入库:    ${n7d}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
