import { PrismaClient } from "../../generated/prisma";
import { detectEventType, scoreImportance } from "../lib/importance";

const db = new PrismaClient();

/**
 * 定期报告补分（sway 直报 ④）：`importance.ts` 新增了 年度报告/半年度报告/季度报告 三个事件词，
 * 但库里已有的那批一手公告还是按旧词典打的分（半年报 45，跟《总经理工作细则》同分）。
 * 这里把**已入库的一手定期报告**重算一遍。
 *
 * 三条边界：
 * - **只处理 PRIMARY**。一手公告的 eventType 本来就是 `detectEventType(title)` 打的（见
 *   `sources/eastmoney-ann.ts`、`sources/cninfo.ts`），按标题重算是忠实的；媒体是按
 *   标题+摘要+正文打的，用标题重算会把它们打低，所以一条都不碰。
 * - **只升不降**。新分不高于旧分就跳过——标题里同时有「停牌」这种更重的词时，旧分本就更准。
 * - **幂等 + 有界分片**。按 id 游标分批，跑一半被杀原样重跑即续（`--limit` 控制单次上限）。
 *
 * 用法：
 *   env DATABASE_URL="postgresql://mac@localhost:5432/jieniu" SKIP_ENV_VALIDATION=1 \
 *     npx tsx src/scripts/rescore-periodic-filings.ts [--limit=50000] [--dry]
 */

const KEYWORDS = ["半年度报告", "季度报告", "年度报告"];
const BATCH = 500;
/** 一手定期报告的目标分（BASELINE 20 + 定期报告 30 + PRIMARY 25）。已达标的不必再扫。 */
const TARGET = 75;

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
}

async function main() {
  const limit = Number(arg("limit") ?? 100_000);
  const dry = process.argv.includes("--dry");
  // 只挑「还没达标」的行：这样每次重跑都从剩下的开始、total 会一路收敛到 0，
  // 而不是每轮都从头扫同一批（分片续跑的前提）。
  const where = {
    tier: "PRIMARY" as const,
    importance: { lt: TARGET },
    OR: KEYWORDS.map((k) => ({ title: { contains: k } })),
  };
  const total = await db.newsItem.count({ where });
  console.log(`待补分的一手定期报告 ${total} 篇（limit=${limit}${dry ? "，dry-run" : ""}）`);

  let cursor: string | undefined;
  let seen = 0;
  let raised = 0;
  const sample: string[] = [];

  while (seen < limit) {
    const batch = await db.newsItem.findMany({
      where,
      select: { id: true, title: true, tier: true, eventType: true, importance: true },
      orderBy: { id: "asc" },
      take: Math.min(BATCH, limit - seen),
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (batch.length === 0) break;
    cursor = batch.at(-1)!.id;
    seen += batch.length;

    for (const it of batch) {
      const eventType = detectEventType(it.title);
      const importance = scoreImportance({ tier: it.tier, eventType });
      if (importance <= it.importance) continue; // 只升不降
      if (sample.length < 5) sample.push(`${it.importance}→${importance} ${it.title.slice(0, 44)}`);
      if (!dry) {
        await db.newsItem.update({
          where: { id: it.id },
          data: { eventType, importance },
        });
      }
      raised++;
    }
    if (seen % 5000 === 0) console.log(`  …已扫 ${seen}，提分 ${raised}`);
  }

  console.log(`\n扫描 ${seen} 篇，提分 ${raised} 篇${dry ? "（dry-run，未写库）" : ""}`);
  for (const s of sample) console.log(`  ${s}`);
  console.log(`仍待处理：${Math.max(0, total - seen)} 篇（重跑本脚本即续）`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
