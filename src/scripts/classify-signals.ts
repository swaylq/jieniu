import { PrismaClient } from "../../generated/prisma";
import { classifyNewsAgainstThesis } from "~/server/ai";
import { isMaterialCandidate, candidateDimensions } from "~/lib/thesis-match";
import type { ThesisDimension } from "~/lib/thesis";

/**
 * 新闻→thesis 维度命中 & 材料度分类（Phase 3 P3-3）。
 * 省 token：只对有 thesis 的实体；Gate 1 只挑重磅/带事件的新闻；跳过已分类过的；全局上限 MAX_NEWS 条新闻上 AI。
 * 用法：secret exec OPENROUTER_API_KEY -- env DATABASE_URL="postgresql://mac@localhost:5432/jieniu" \
 *   SKIP_ENV_VALIDATION=1 OPENROUTER_MODEL="anthropic/claude-sonnet-4.5" MAX_NEWS=20 npx tsx src/scripts/classify-signals.ts
 */
const db = new PrismaClient();
const MAX_NEWS = Number(process.env.MAX_NEWS ?? 30);

async function main() {
  const theses = await db.thesis.findMany({
    select: { entityId: true, dimensions: true, entity: { select: { name: true } } },
  });
  let processed = 0;
  let written = 0;

  for (const th of theses) {
    if (processed >= MAX_NEWS) break;
    const dims = th.dimensions as unknown as ThesisDimension[];
    if (!Array.isArray(dims) || dims.length === 0) continue;

    const links = await db.newsEntity.findMany({
      where: { entityId: th.entityId },
      orderBy: { news: { publishedAt: "desc" } },
      take: 40,
      select: {
        news: {
          select: {
            id: true,
            title: true,
            summary: true,
            importance: true,
            eventType: true,
            tier: true,
            publishedAt: true,
            eventId: true,
          },
        },
      },
    });
    const doneIds = new Set(
      (
        await db.thesisSignal.findMany({
          where: { entityId: th.entityId },
          select: { newsId: true },
        })
      ).map((s) => s.newsId),
    );

    // 同一事件（eventId）多篇报道只取一篇代表分类（importance 最高，并列取更近），
    // 避免同事件被逐篇分类导致 signal 计数虚高、进而误报维度跨越/组合变动（P4-7「一簇一次 signal」）。
    const repByEvent = new Map<string, { id: string; importance: number }>();
    for (const l of links) {
      const ev = l.news.eventId;
      if (!ev) continue;
      const cur = repByEvent.get(ev);
      if (!cur || l.news.importance > cur.importance) {
        repByEvent.set(ev, { id: l.news.id, importance: l.news.importance });
      }
    }

    for (const l of links) {
      if (processed >= MAX_NEWS) break;
      const n = l.news;
      if (doneIds.has(n.id)) continue;
      if (n.eventId && repByEvent.get(n.eventId)?.id !== n.id) continue; // 非代表篇跳过
      if (
        !isMaterialCandidate({
          importance: n.importance,
          eventType: n.eventType,
          tier: n.tier,
        })
      ) {
        continue;
      }
      processed++;
      const cand = candidateDimensions(dims, `${n.title}\n${n.summary ?? ""}`);
      const use = cand.length > 0 ? cand : dims;
      try {
        const signals = await classifyNewsAgainstThesis(
          { title: n.title, summary: n.summary, eventType: n.eventType },
          use,
        );
        for (const s of signals) {
          await db.thesisSignal.upsert({
            where: {
              entityId_newsId_dimensionKey: {
                entityId: th.entityId,
                newsId: n.id,
                dimensionKey: s.dimensionKey,
              },
            },
            create: {
              entityId: th.entityId,
              newsId: n.id,
              dimensionKey: s.dimensionKey,
              direction: s.direction,
              materiality: s.materiality,
              note: s.note,
              newsTitle: n.title,
              publishedAt: n.publishedAt,
            },
            update: { direction: s.direction, materiality: s.materiality, note: s.note },
          });
          written++;
        }
        console.log(`  ${th.entity.name} · "${n.title.slice(0, 22)}…" → ${signals.length} 信号`);
      } catch (err) {
        console.error(`  ✗ ${n.title.slice(0, 18)}:`, (err as Error).message);
      }
    }
  }
  console.log(`done: 处理 ${processed} 条新闻，写入 ${written} 条信号`);
  await db.$disconnect();
}

void main();
