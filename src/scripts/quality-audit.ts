// 数据质量审计（2026-07-23 一年回填后）。**只测量、不改数据**——先知道脏在哪，再决定修什么。
// 用法：... npx tsx src/scripts/quality-audit.ts
//
// 查这几类：体裁构成 / 空绑定 / 标题异常 / 日期异常 / 疑似跨源重复 / 高频样板标题 / 研报归属。

import { PrismaClient } from "../../generated/prisma";
import { normalizeTitle, stripEntityPrefix } from "../lib/dedupe";
import { IMPORTANT_THRESHOLD } from "../lib/importance";

const db = new PrismaClient();

type Row = Record<string, unknown>;
async function q<T = Row>(sql: string): Promise<T[]> {
  const rows = await db.$queryRawUnsafe<T[]>(sql);
  return rows.map((r) => {
    const o: Row = {};
    for (const [k, v] of Object.entries(r as Row))
      o[k] = typeof v === "bigint" ? Number(v) : v;
    return o as T;
  });
}

const pct = (a: number, b: number) => `${((a / b) * 100).toFixed(1)}%`;

async function main() {
  const total = await db.newsItem.count();
  console.log(`语料总量 ${total} 条\n`);

  console.log("═══ A. 事件类型构成（回填后是否被例行公告稀释）═══");
  console.table(
    await q(`
      SELECT COALESCE(n."eventType", '(无事件类型)') AS "事件类型",
             count(*)::int AS "条数",
             round(100.0*count(*)/${total}, 1)::float8 AS "占比%"
      FROM "NewsItem" n
      GROUP BY n."eventType" ORDER BY count(*) DESC LIMIT 12`),
  );

  console.log("═══ B. 空绑定（没绑到任何实体 = 页面上根本看不到，纯占库）═══");
  const orphan = await db.newsItem.count({ where: { entities: { none: {} } } });
  console.log(`  ${orphan} 条 / ${pct(orphan, total)}`);
  console.table(
    await q(`
      SELECT s.name AS "来源", count(*)::int AS "空绑定条数"
      FROM "NewsItem" n
      JOIN "Source" s ON s.id = n."sourceId"
      WHERE NOT EXISTS (SELECT 1 FROM "NewsEntity" ne WHERE ne."newsId" = n.id)
      GROUP BY s.name ORDER BY count(*) DESC`),
  );

  console.log("═══ C. 标题异常 ═══");
  const [longTitle, htmlish, dupPrefix, fileish] = await Promise.all([
    db.newsItem.count({ where: { title: { contains: "  " } } }),
    db.newsItem.count({ where: { OR: [{ title: { contains: "<" } }, { title: { contains: "&nbsp" } }] } }),
    db.newsItem.count({ where: { title: { contains: "::" } } }),
    db.newsItem.count({ where: { OR: [{ title: { endsWith: ".pdf" } }, { title: { endsWith: ".PDF" } }] } }),
  ]);
  console.log(`  连续空格 ${longTitle} · 残留 HTML ${htmlish} · 异常分隔 ${dupPrefix} · 以 .pdf 结尾 ${fileish}`);

  console.log("\n═══ D. 日期异常 ═══");
  const now = new Date();
  const future = await db.newsItem.count({ where: { publishedAt: { gt: new Date(now.getTime() + 36e5) } } });
  const ancient = await db.newsItem.count({ where: { publishedAt: { lt: new Date("2024-01-01") } } });
  console.log(`  未来日期 ${future} 条 · 早于 2024 的 ${ancient} 条`);

  console.log("\n═══ E. 疑似跨源重复（同公司 + 去前缀标题相同，但发布日不同）═══");
  // historicalKey 带发布日，两源同一份公告若披露日差一天就漏判。这里放宽到「不看日期」再数一遍。
  const rows = await q<{ entityId: string; entity: string; title: string; day: string }>(`
    SELECT ne."entityId", e.name AS entity, n.title, n."publishedAt"::date::text AS day
    FROM "NewsItem" n
    JOIN "NewsEntity" ne ON ne."newsId" = n.id
    JOIN "Entity" e ON e.id = ne."entityId"
    WHERE e.type = 'COMPANY' AND n.tier = 'PRIMARY'`);
  const byKey = new Map<string, { entity: string; title: string; days: Set<string> }>();
  for (const r of rows) {
    const key = `${r.entityId}::${normalizeTitle(stripEntityPrefix(r.title))}`;
    const hit = byKey.get(key);
    if (hit) hit.days.add(r.day);
    else byKey.set(key, { entity: r.entity, title: r.title, days: new Set([r.day]) });
  }
  // 只报「日期相邻（≤2 天）」的——同名周期性公告（回购进展按月发）日期相隔很远，不算重复。
  const suspects: { entity: string; title: string; days: string }[] = [];
  for (const v of byKey.values()) {
    if (v.days.size < 2) continue;
    const ds = [...v.days].sort();
    for (let i = 1; i < ds.length; i++) {
      const gap = (Date.parse(ds[i]!) - Date.parse(ds[i - 1]!)) / 86400000;
      if (gap <= 2) {
        suspects.push({ entity: v.entity, title: v.title.slice(0, 40), days: `${ds[i - 1]}/${ds[i]}` });
        break;
      }
    }
  }
  console.log(`  疑似 ${suspects.length} 组`);
  suspects.slice(0, 10).forEach((s) => console.log(`   - ${s.entity} | ${s.title} | ${s.days}`));

  console.log("\n═══ F. 高频标题 Top 15（样板公告有多刷屏）═══");
  console.table(
    await q(`
      SELECT n.title AS "标题", count(*)::int AS "条数"
      FROM "NewsItem" n
      GROUP BY n.title HAVING count(*) > 20
      ORDER BY count(*) DESC LIMIT 15`),
  );

  console.log("═══ G. 研报归属 ═══");
  const reports = await q<{ bound: number; c: number }>(`
    SELECT bound, count(*)::int AS c FROM (
      SELECT n.id, count(ne."entityId")::int AS bound
      FROM "NewsItem" n
      JOIN "Source" s ON s.id = n."sourceId"
      LEFT JOIN "NewsEntity" ne ON ne."newsId" = n.id
      WHERE s.key = 'eastmoney-report'
      GROUP BY n.id
    ) t GROUP BY bound ORDER BY bound`);
  console.log(
    "  绑定实体数分布：" +
      reports.map((r) => `${r.bound}个→${r.c}篇`).join("  "),
  );

  console.log("\n═══ H. 重磅密度（大事记能取到多少）═══");
  const important = await db.newsItem.count({
    where: { importance: { gte: IMPORTANT_THRESHOLD } },
  });
  console.log(`  重磅 ${important} 条 / ${pct(important, total)}`);
  console.table(
    await q(`
      WITH m AS (
        SELECT e.id, count(*)::int AS c
        FROM "NewsItem" n
        JOIN "NewsEntity" ne ON ne."newsId" = n.id
        JOIN "Entity" e ON e.id = ne."entityId"
        WHERE e.type = 'COMPANY' AND n.importance >= ${IMPORTANT_THRESHOLD}
        GROUP BY e.id
      )
      SELECT count(*)::int AS "有重磅的公司",
             min(c)::int AS "最少", round(avg(c),1)::float8 AS "平均", max(c)::int AS "最多"
      FROM m`),
  );

  console.log("═══ I. 单公司条数极值（页面会不会被某家撑爆）═══");
  console.table(
    await q(`
      SELECT e.name AS "公司", count(*)::int AS "条数"
      FROM "NewsItem" n
      JOIN "NewsEntity" ne ON ne."newsId" = n.id
      JOIN "Entity" e ON e.id = ne."entityId"
      WHERE e.type = 'COMPANY'
      GROUP BY e.name ORDER BY count(*) DESC LIMIT 5`),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
