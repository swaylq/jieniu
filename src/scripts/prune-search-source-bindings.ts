// 存量清理（2026-08-03，潞与张楚寒的第二轮）：个股资讯源「搜到的就绑」留下的误绑。
//
// `eastmoney-stocknews` 是东财的**搜索**接口，按公司名去搜，然后把结果无条件绑到这只股
// （`entityHints`）。搜非 A 股名字（携程 / 泛林 / 富途这类中概与美股）时基本搜不到东西，
// 接口退化成返回一批通用最新资讯——**近 7 天携程被绑了 1872 条，其中 1867 条文章里
// 连「携程」两个字都没有**（「江苏靖江 深耕制造立市」「上半年上海网络游戏总收入超950亿元」…）。
// 泛林 263 条、富途 22 条同理。这类失败是静默的：fetched 有值、无报错、tagged>0，指标全正常。
//
// 入库端已修（见 sources/eastmoney-stocknews.ts 的 `mentions`：文章真提到了才给主体线索），
// 本脚本用**同一个判据**复算历史绑定，文章里压根没提到这家公司的绑定剪掉。
//
// 只动 `eastmoney-stocknews` 这一个源的 COMPANY/STOCK 绑定：
//   · 公告 / 龙虎榜 / 研报的主体是源权威给的，一条不碰；
//   · 板块绑定不碰（行业稿绑板块本来就对）。
// 判据比入库端**更宽**（连别名一起认），宁可少剪。幂等：再跑一次不会多剪。
//
// 用法：
//   npx tsx src/scripts/prune-search-source-bindings.ts                 # dry-run
//   npx tsx src/scripts/prune-search-source-bindings.ts --apply --expect=12345
//
// `--expect` 是防呆闸：dry-run 复核过的条数与 apply 实际要删的对不上就退出非 0
// （dry-run 之后任何一次判据改动都让复核作废，见 lessons「dry-run 与 apply 必须跑同一份代码」）。

import { PrismaClient } from "../../generated/prisma";
import { titleNamesSubject } from "../lib/news-subject";

const db = new PrismaClient();

const SOURCE_KEY = "eastmoney-stocknews";

type Row = {
  newsId: string;
  entityId: string;
  title: string;
  summary: string | null;
  name: string;
  shortName: string | null;
  aliases: string[];
  ticker: string | null;
};

async function main() {
  const apply = process.argv.includes("--apply");
  const expectArg = process.argv.find((a) => a.startsWith("--expect="));
  const expect = expectArg ? Number(expectArg.slice("--expect=".length)) : null;

  const rows = await db.$queryRawUnsafe<Row[]>(
    `
    SELECT ne."newsId", ne."entityId", n.title, n.summary,
           e.name, e."shortName", e.aliases, e.ticker
    FROM "NewsEntity" ne
    JOIN "NewsItem" n ON n.id = ne."newsId"
    JOIN "Source" s ON s.id = n."sourceId"
    JOIN "Entity" e ON e.id = ne."entityId"
    WHERE s.key = $1 AND e.type IN ('COMPANY','STOCK')
  `,
    SOURCE_KEY,
  );

  const doomed: Row[] = [];
  for (const r of rows) {
    if (titleNamesSubject(`${r.title}\n${r.summary ?? ""}`, r)) continue;
    doomed.push(r);
  }

  const byEntity = new Map<string, number>();
  for (const d of doomed) byEntity.set(d.name, (byEntity.get(d.name) ?? 0) + 1);

  console.log(`${SOURCE_KEY} 的 COMPANY/STOCK 绑定共 ${rows.length} 条`);
  console.log(
    `文章里压根没提到该公司的：${doomed.length} 条（${((doomed.length / Math.max(rows.length, 1)) * 100).toFixed(1)}%）`,
  );
  console.log("\n按实体（前 15）：");
  for (const [k, v] of [...byEntity].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${k.padEnd(18)} ${v}`);
  }
  console.log("\n样例（随手取 10 条，逐条看一眼再 apply）：");
  for (const d of doomed.slice(0, 10)) console.log(`  ${d.name} ← ${d.title}`);

  if (!apply) {
    console.log(
      `\n(dry-run) 加 --apply --expect=${doomed.length} 才真删。复核完样例再跑。`,
    );
    return;
  }
  if (expect === null) {
    console.error("✗ --apply 必须带 --expect=<dry-run 报出来的条数>");
    process.exitCode = 1;
    return;
  }
  if (expect !== doomed.length) {
    console.error(
      `✗ 条数对不上：--expect=${expect}，本次算出 ${doomed.length} 条。` +
        `判据或数据在 dry-run 之后变过，复核作废，请重新 dry-run。`,
    );
    process.exitCode = 1;
    return;
  }

  let removed = 0;
  for (let i = 0; i < doomed.length; i += 500) {
    const batch = doomed.slice(i, i + 500);
    const res = await db.$executeRawUnsafe(
      `DELETE FROM "NewsEntity" WHERE ("newsId", "entityId") IN (${batch
        .map((_, k) => `($${k * 2 + 1}, $${k * 2 + 2})`)
        .join(",")})`,
      ...batch.flatMap((b) => [b.newsId, b.entityId]),
    );
    removed += res;
    console.log(`  已删 ${removed}/${doomed.length}`);
  }
  console.log(`✓ 剪除 ${removed} 条误绑`);
}

main()
  .catch((e) => {
    console.error("失败:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
