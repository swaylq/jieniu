// 「有效产品覆盖」报告：回答 coverage-report 回答不了的那个问题——
// **有新闻 ≠ 用户能感觉到这家公司有东西可看。**
//
// coverage-report 证明的是「库里有数据」；这份要定位价值在哪一层漏掉：
//   实体绑定 → thesis → 工作台呈现 → 排序/筛选 → 用户实际看到的卡片
// 只读统计，不改任何数据。
// 用法：DATABASE_URL=... npx tsx src/scripts/effective-coverage.ts

import { PrismaClient } from "../../generated/prisma";
import { HOT_SECTOR_NAMES } from "../lib/hot-universe";
import { IMPORTANT_THRESHOLD } from "../lib/importance";

const db = new PrismaClient();
const DAY = 24 * 60 * 60 * 1000;

const pct = (a: number, b: number) => (b === 0 ? "—" : `${((a / b) * 100).toFixed(1)}%`);
const bar = (a: number, b: number, w = 28) => {
  if (b === 0) return "";
  const f = Math.round((a / b) * w);
  return "█".repeat(f) + "░".repeat(w - f);
};

async function main() {
  const now = Date.now();
  const d7 = new Date(now - 7 * DAY);

  const companies = await db.entity.findMany({
    where: { type: "COMPANY" },
    select: {
      id: true,
      name: true,
      thesis: { select: { id: true } },
      relFrom: { where: { type: "ISSUES" }, select: { toId: true } },
    },
  });
  const total = companies.length;
  const idOf = new Map(companies.map((c) => [c.id, c]));

  // 每家公司：绑定资讯数 / 近7天 / 重要资讯数
  const [allBind, bind7, imp7] = await Promise.all([
    db.newsEntity.groupBy({
      by: ["entityId"],
      where: { entityId: { in: companies.map((c) => c.id) } },
      _count: { entityId: true },
    }),
    db.newsEntity.groupBy({
      by: ["entityId"],
      where: {
        entityId: { in: companies.map((c) => c.id) },
        news: { publishedAt: { gte: d7 } },
      },
      _count: { entityId: true },
    }),
    db.newsEntity.groupBy({
      by: ["entityId"],
      where: {
        entityId: { in: companies.map((c) => c.id) },
        news: { publishedAt: { gte: d7 }, importance: { gte: IMPORTANT_THRESHOLD } },
      },
      _count: { entityId: true },
    }),
  ]);
  const nAll = new Map(allBind.map((r) => [r.entityId, r._count.entityId]));
  const n7 = new Map(bind7.map((r) => [r.entityId, r._count.entityId]));
  const nImp7 = new Map(imp7.map((r) => [r.entityId, r._count.entityId]));

  const hotSectors = await db.entity.findMany({
    where: { type: "SECTOR", name: { in: [...HOT_SECTOR_NAMES] } },
    select: { id: true },
  });
  const hotIds = new Set(
    (
      await db.entityRelation.findMany({
        where: {
          type: "BELONGS_TO",
          toId: { in: hotSectors.map((s) => s.id) },
          from: { type: "COMPANY" },
        },
        select: { fromId: true },
      })
    ).map((r) => r.fromId),
  );

  console.log("=== 解牛「有效产品覆盖」报告 ===");
  console.log(`生成时间: ${new Date(now).toISOString()}`);
  console.log(`公司总数: ${total}（其中重点覆盖热门股 ${hotIds.size}）`);
  console.log("");

  // ── 漏斗：从「有实体」一路收窄到「用户真能看到有判断的公司」
  const hasStock = companies.filter((c) => c.relFrom.length > 0).length;
  const hasNews = companies.filter((c) => (nAll.get(c.id) ?? 0) > 0).length;
  const hasNews7 = companies.filter((c) => (n7.get(c.id) ?? 0) > 0).length;
  const hasThesis = companies.filter((c) => c.thesis).length;
  const newsAndThesis = companies.filter(
    (c) => (nAll.get(c.id) ?? 0) > 0 && c.thesis,
  ).length;

  console.log("【价值漏斗】每一层砍掉多少");
  const steps: [string, number][] = [
    ["有公司实体", total],
    ["└ 有股票代码绑定", hasStock],
    ["  └ 有任意资讯", hasNews],
    ["    └ 近7天有资讯", hasNews7],
    ["      └ 且有投资逻辑(thesis)", newsAndThesis],
  ];
  for (const [label, n] of steps) {
    console.log(`  ${label.padEnd(22)} ${String(n).padStart(4)} ${bar(n, total)} ${pct(n, total)}`);
  }
  console.log("");

  // ── 核心诊断：有料但没判断
  const newsNoThesis = companies.filter(
    (c) => (nAll.get(c.id) ?? 0) > 0 && !c.thesis,
  );
  const hotNoThesis = newsNoThesis.filter((c) => hotIds.has(c.id));
  console.log("【诊断①：有资讯但没有投资逻辑】——「抓到了但没形成判断」");
  console.log(`  有资讯无 thesis: ${newsNoThesis.length}/${hasNews} (${pct(newsNoThesis.length, hasNews)})`);
  console.log(`    其中属于重点覆盖热门股: ${hotNoThesis.length}  ← 这部分才是真缺口`);
  console.log(`    其余为长尾公司: ${newsNoThesis.length - hotNoThesis.length}（按聚焦策略本就不生成 thesis）`);
  console.log("");

  // ── 近7天有重磅但没判断 = 最该补的优先级队列
  const impNoThesis = companies
    .filter((c) => (nImp7.get(c.id) ?? 0) > 0 && !c.thesis)
    .sort((a, b) => (nImp7.get(b.id) ?? 0) - (nImp7.get(a.id) ?? 0));
  console.log("【诊断②：近7天有重磅资讯、却没有 thesis】——补 thesis 的优先队列");
  console.log(`  共 ${impNoThesis.length} 家（重要性 ≥ ${IMPORTANT_THRESHOLD}）`);
  for (const c of impNoThesis.slice(0, 15)) {
    const tag = hotIds.has(c.id) ? "热门" : "长尾";
    console.log(`    ${c.name}（近7天重磅 ${nImp7.get(c.id)} 条 · ${tag}）`);
  }
  console.log("");

  // ── 资讯是否转化成「可读卡片」：摘要缺失会让卡片只剩标题
  const [newsTotal, noSummary, noContent, interpreted] = await Promise.all([
    db.newsItem.count(),
    // NewsItem.summary 非空（schema 里是 String 不是 String?），只可能是空串
    db.newsItem.count({ where: { summary: "" } }),
    db.newsItem.count({ where: { OR: [{ content: null }, { content: "" }] } }),
    db.interpretation.count(),
  ]);
  console.log("【诊断③：资讯 → 可读卡片的转化】");
  console.log(`  资讯总数: ${newsTotal}`);
  console.log(`  缺摘要(卡片只剩标题): ${noSummary} (${pct(noSummary, newsTotal)})`);
  console.log(`  缺正文(详情页只能跳原文): ${noContent} (${pct(noContent, newsTotal)})`);
  console.log(`  已生成 AI 解读: ${interpreted}（按需生成，省 token 铁律，不是缺陷）`);
  console.log("");

  // ── 未绑定任何实体的资讯 = 抓了但没进任何公司页
  const unbound = await db.newsItem.count({ where: { entities: { none: {} } } });
  console.log("【诊断④：抓到但没进任何公司页】");
  console.log(`  未绑定任何实体的资讯: ${unbound}/${newsTotal} (${pct(unbound, newsTotal)})`);
  console.log(`  （综述/榜单/宏观类本就该不绑定，非全是问题；异常升高才需查匹配）`);
  console.log("");

  // ── 用户搜索能否看到"有料"的公司
  const emptyish = companies.filter((c) => (nAll.get(c.id) ?? 0) === 0);
  console.log("【诊断⑤：搜到了但打开是空的】");
  console.log(`  零资讯公司: ${emptyish.length} —— 用户搜到却什么都看不到`);
  if (emptyish.length > 0) {
    console.log(`    ${emptyish.slice(0, 10).map((c) => c.name).join("、")}`);
  }
  console.log("");

  console.log("【结论指引】");
  console.log(`  · 若 诊断① 的「热门股无 thesis」≈0 → 判断层没缺口，用户体感问题在呈现/排序`);
  console.log(`  · 若 诊断② 队列长 → 优先按此队列补 thesis（有重磅=有料可判断）`);
  console.log(`  · 若 诊断③ 缺摘要占比高 → 卡片信息量不足，先补摘要而非补公司数`);
  console.log(`  · 若 诊断⑤ >0 → 实体匹配/命名问题（跑 fix-prefixed-names.ts）`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
