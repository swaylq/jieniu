// 回填体检（Phase 4 验证工具）：回填前后各跑一次对比，专查三件会被回填搞坏的事——
//   ① 重复：同公司 + 同标题 + 同发布日 出现多条（跨源/重跑造成）
//   ② 提醒中心被淹：进得了提醒窗口的历史资讯条数
//   ③ 覆盖是否真的变厚：每只股绑定资讯数的分布 + 时间跨度
// 用法：... npx tsx src/scripts/backfill-check.ts

import { PrismaClient } from "../../generated/prisma";
import { notifyWindowStart, NOTIFY_WINDOW_DAYS } from "../lib/format";
import { IMPORTANT_THRESHOLD } from "../lib/importance";
import { isRatingHeadline } from "../lib/compliance";
import { isReportPublisherOf } from "../lib/relevance";

const db = new PrismaClient();

type Row = Record<string, unknown>;
const n = (v: unknown) => (typeof v === "bigint" ? Number(v) : v);

async function q<T = Row>(sql: string): Promise<T[]> {
  const rows = await db.$queryRawUnsafe<T[]>(sql);
  return rows.map((r) => {
    const o: Row = {};
    for (const [k, v] of Object.entries(r as Row)) o[k] = n(v);
    return o as T;
  });
}

async function main() {
  console.log("═══ 1. 各源规模与时间跨度 ═══");
  const sources = await q(`
    SELECT s.name, count(*)::int AS items,
           min(n."publishedAt")::date::text AS oldest,
           max(n."publishedAt")::date::text AS newest
    FROM "NewsItem" n JOIN "Source" s ON s.id = n."sourceId"
    GROUP BY s.name ORDER BY items DESC`);
  console.table(sources);

  console.log("\n═══ 2. 覆盖股绑定资讯数分布 ═══");
  const dist = await q(`
    WITH b AS (
      SELECT e.id, count(ne."newsId")::int AS bound
      FROM "Entity" e LEFT JOIN "NewsEntity" ne ON ne."entityId" = e.id
      WHERE e.type = 'STOCK' AND e.ticker IS NOT NULL
      GROUP BY e.id
    )
    SELECT count(*)::int AS stocks,
      sum(CASE WHEN bound = 0 THEN 1 ELSE 0 END)::int AS "0条",
      sum(CASE WHEN bound BETWEEN 1 AND 19 THEN 1 ELSE 0 END)::int AS "1-19条",
      sum(CASE WHEN bound BETWEEN 20 AND 59 THEN 1 ELSE 0 END)::int AS "20-59条",
      sum(CASE WHEN bound >= 60 THEN 1 ELSE 0 END)::int AS "60条以上",
      round(avg(bound), 1)::float8 AS "平均"
    FROM b`);
  console.table(dist);

  console.log("\n═══ 3. 重复体检（同公司+同标题+同发布日 ≥2 条）═══");
  const dupes = await q(`
    SELECT e.name AS entity, n.title, n."publishedAt"::date::text AS day,
           count(*)::int AS copies
    FROM "NewsItem" n
    JOIN "NewsEntity" ne ON ne."newsId" = n.id
    JOIN "Entity" e ON e.id = ne."entityId"
    WHERE e.type = 'COMPANY'
    GROUP BY e.name, n.title, n."publishedAt"::date
    HAVING count(*) > 1
    ORDER BY copies DESC LIMIT 15`);
  if (dupes.length === 0) console.log("  ✓ 无重复");
  else {
    console.log(`  ⚠ ${dupes.length} 组（仅列前 15）`);
    console.table(dupes);
  }

  console.log(`\n═══ 4. 提醒中心闸门（窗口 ${NOTIFY_WINDOW_DAYS} 天）═══`);
  const since = notifyWindowStart(new Date());
  const [inWindow, allImportant] = await Promise.all([
    db.newsItem.count({
      where: {
        importance: { gte: IMPORTANT_THRESHOLD },
        publishedAt: { gte: since },
      },
    }),
    db.newsItem.count({ where: { importance: { gte: IMPORTANT_THRESHOLD } } }),
  ]);
  console.log(
    `  重磅资讯总数 ${allImportant} → 其中进得了提醒窗口的 ${inWindow}` +
      `（被闸门挡住的历史资讯 ${allImportant - inWindow} 条）`,
  );

  console.log("\n═══ 5. 研报合规与归属体检（铁律②）═══");
  const reports = await db.newsItem.findMany({
    where: { source: { key: "eastmoney-report" } },
    select: {
      title: true,
      entities: { select: { entity: { select: { name: true, type: true } } } },
    },
  });
  if (reports.length === 0) console.log("  （暂无研报）");
  else {
    const bad = reports.filter((r) => isRatingHeadline(r.title));
    console.log(
      `  研报 ${reports.length} 篇 → 标题含评级/目标价的 ${bad.length} 篇` +
        (bad.length === 0 ? "  ✓" : "  ⚠"),
    );
    bad.slice(0, 5).forEach((b) => console.log(`     ⚠ ${b.title}`));
    // 券商 feed 污染体检：研报绑到了「发布机构自己」= run3 旧疾复发
    const selfBound = reports.filter((r) =>
      r.entities.some((e) => isReportPublisherOf(r.title, e.entity)),
    );
    console.log(
      `  绑到发布机构自身的 ${selfBound.length} 篇` +
        (selfBound.length === 0 ? "  ✓" : "  ⚠ 券商 feed 会被污染"),
    );
    selfBound.slice(0, 5).forEach((b) => console.log(`     ⚠ ${b.title}`));
  }

  console.log("\n═══ 6. 抽样：绑定最多的 8 家公司的时间跨度 ═══");
  const spread = await q(`
    SELECT e.name AS entity, count(*)::int AS items,
           min(n."publishedAt")::date::text AS oldest,
           max(n."publishedAt")::date::text AS newest
    FROM "NewsItem" n
    JOIN "NewsEntity" ne ON ne."newsId" = n.id
    JOIN "Entity" e ON e.id = ne."entityId"
    WHERE e.type = 'COMPANY'
    GROUP BY e.name ORDER BY items DESC LIMIT 8`);
  console.table(spread);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
