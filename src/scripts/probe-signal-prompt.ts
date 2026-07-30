import { PrismaClient } from "../../generated/prisma";
import { classifyNewsAgainstThesis } from "~/server/ai";
import {
  isMaterialCandidate,
  candidateDimensions,
  isEvidenceCandidate,
  evidenceBody,
} from "~/lib/thesis-match";
import { isDigestWorthyFiling } from "~/lib/market-digest";
import { judgeEvidence } from "~/lib/evidence";
import type { ThesisDimension } from "~/lib/thesis";

/**
 * 证据提示词的**逐条肉眼探针**（只读，不写库）。
 *
 * 「模型不出货」有两种完全不同的原因，输出上长得一模一样：
 *   ① 喂进去的东西本来就没有证据价值（正确行为）
 *   ② 提示词/判据太严，把真证据也挡了（bug）
 * 分辨它们唯一的办法是**把喂进去的和吐出来的都打出来逐条看**。
 *
 * 用法：
 *   secret exec OPENROUTER_API_KEY -- env DATABASE_URL="postgresql://mac@localhost:5432/jieniu" \
 *     SKIP_ENV_VALIDATION=1 OPENROUTER_MODEL="deepseek/deepseek-chat" \
 *     npx tsx src/scripts/probe-signal-prompt.ts [--n=8]
 */
const db = new PrismaClient();

async function main() {
  const nArg = process.argv.find((a) => a.startsWith("--n="));
  const N = nArg ? Number(nArg.slice(4)) : 8;

  const theses = await db.$queryRawUnsafe<
    { entityId: string; name: string; dimensions: unknown }[]
  >(`
    SELECT t."entityId", e.name, t.dimensions
    FROM "Thesis" t JOIN "Entity" e ON e.id = t."entityId"
    ORDER BY (SELECT count(*) FROM "Watchlist" w WHERE w."entityId" = t."entityId") DESC
    LIMIT 12
  `);

  let shown = 0;
  for (const th of theses) {
    if (shown >= N) break;
    const dims = th.dimensions as ThesisDimension[];
    if (!Array.isArray(dims) || dims.length === 0) continue;

    const links = await db.newsEntity.findMany({
      where: { entityId: th.entityId },
      orderBy: { news: { publishedAt: "desc" } },
      take: 12,
      select: {
        news: {
          select: {
            title: true,
            summary: true,
            content: true,
            importance: true,
            eventType: true,
            tier: true,
            source: { select: { name: true } },
          },
        },
      },
    });

    for (const l of links) {
      if (shown >= N) break;
      const n = l.news;
      if (!isMaterialCandidate({ importance: n.importance, eventType: n.eventType, tier: n.tier }))
        continue;
      if (!isDigestWorthyFiling(n.title)) continue;
      if (!isEvidenceCandidate(n.title)) continue;
      shown++;

      const cand = candidateDimensions(dims, `${n.title}\n${n.summary ?? ""}`);
      const use = cand.length > 0 ? cand : dims;
      console.log(`\n${"=".repeat(78)}`);
      console.log(`【${th.name}】${n.title}`);
      console.log(`  来源 ${n.source.name}｜tier ${n.tier}｜importance ${n.importance}｜事件 ${n.eventType ?? "—"}`);
      const body = evidenceBody(n.title, n.content, n.summary);
      console.log(`  喂进去的正文(${body.length}字)：${body.slice(0, 200)}`);
      console.log(`  候选维度(${use.length}/${dims.length})：${use.map((d) => d.key).join("、")}`);

      try {
        const out = await classifyNewsAgainstThesis(
          {
            title: n.title,
            summary: body,
            eventType: n.eventType,
            subject: th.name,
            tier: n.tier,
            sourceName: n.source.name,
          },
          use,
        );
        if (out.length === 0) {
          console.log(`  → 模型返回 []（没有证据）`);
          continue;
        }
        for (const s of out) {
          const v = judgeEvidence({
            fact: s.fact,
            why: s.why,
            dimensionKey: s.dimensionKey,
            subject: th.name,
            newsTitle: n.title,
            tier: n.tier,
          });
          console.log(`  → [${s.dimensionKey}|${s.direction}|${s.materiality}] ${v.ok ? "✓" : "✗"} ${v.ok ? v.grade : v.reason}`);
          console.log(`     事实：${s.fact}`);
          console.log(`     为何：${s.why || "（模型没给）"}`);
        }
      } catch (e) {
        console.log(`  ✗ 调用失败：${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  process.exitCode = 1;
  await db.$disconnect();
});
