import { PrismaClient } from "../../generated/prisma";
import { classifyNewsAgainstThesis } from "~/server/ai";
import { isMaterialCandidate, candidateDimensions } from "~/lib/thesis-match";
import { isDigestWorthyFiling } from "~/lib/market-digest";
import type { ThesisDimension } from "~/lib/thesis";

/**
 * 新闻 → thesis 维度信号的**有界分片**回填（2026-07-28）。
 *
 * 背景：`ThesisSignal` 全库只有 11 条 / 3 个实体，导致「敏感度」旋钮没有可作用的对象
 * （阈值 高40/中60/低80，而库里材料度全 <60 → 中低两档恒 0 条）。
 * 根因是老的 `classify-signals.ts` 有个**全局** `MAX_NEWS=30` 上限、且从没挂上 cron。
 *
 * 这个脚本按「回填三律」写：
 * - **幂等**：已分类过的 (entity,news) 直接跳过，被杀了原样重跑即续
 * - **有界分片**：`--limit` 控制单轮上 AI 的新闻条数，一片跑 20–30 分钟内结束
 *   （长任务就算单跑也会被系统回收——今天刚踩过）
 * - **按需重排**：先自选股、再新闻多的，让用户真正会看的先有信号
 *
 * 用法：
 *   secret exec OPENROUTER_API_KEY -- env DATABASE_URL="postgresql://mac@localhost:5432/jieniu" \
 *     SKIP_ENV_VALIDATION=1 OPENROUTER_MODEL="deepseek/deepseek-chat" \
 *     npx tsx src/scripts/backfill-signals.ts [--limit=200] [--concurrency=6] [--per-entity=12]
 */
const db = new PrismaClient();

function num(flag: string, dflt: number): number {
  const a = process.argv.find((x) => x.startsWith(`--${flag}=`));
  const v = a ? Number(a.slice(flag.length + 3)) : NaN;
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

type Job = {
  entityId: string;
  entityName: string;
  dims: ThesisDimension[];
  newsId: string;
  title: string;
  summary: string | null;
  eventType: string | null;
  publishedAt: Date;
};

/** 有 thesis 的实体，按「被自选 → 新闻多」排序。 */
async function pickEntities(limit: number) {
  return db.$queryRawUnsafe<{ entityId: string; name: string; dimensions: unknown }[]>(
    `
    SELECT t."entityId", e.name, t.dimensions
    FROM "Thesis" t
    JOIN "Entity" e ON e.id = t."entityId"
    ORDER BY (SELECT count(*) FROM "Watchlist" w WHERE w."entityId" = t."entityId") DESC,
             (SELECT count(*) FROM "NewsEntity" ne WHERE ne."entityId" = t."entityId") DESC
    LIMIT $1
  `,
    limit,
  );
}

/** 攒出本轮要上 AI 的 (实体, 新闻) 任务，直到 limit 条为止。 */
async function buildJobs(limit: number, perEntity: number): Promise<Job[]> {
  const jobs: Job[] = [];
  // 取比 limit 多的实体候选：大部分实体的新闻早分类完了，会被跳过
  const entities = await pickEntities(Math.max(limit, 400));

  for (const ent of entities) {
    if (jobs.length >= limit) break;
    const dims = ent.dimensions as ThesisDimension[];
    if (!Array.isArray(dims) || dims.length === 0) continue;

    const links = await db.newsEntity.findMany({
      where: { entityId: ent.entityId },
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
    if (links.length === 0) continue;

    const done = new Set(
      (
        await db.thesisSignal.findMany({
          where: { entityId: ent.entityId },
          select: { newsId: true },
        })
      ).map((s) => s.newsId),
    );

    // 同一事件多篇报道只分类一篇代表（importance 最高）——否则同事件被逐篇计数，
    // 会把维度跨越误判成「反复触发」。
    const repByEvent = new Map<string, { id: string; importance: number }>();
    for (const l of links) {
      const ev = l.news.eventId;
      if (!ev) continue;
      const cur = repByEvent.get(ev);
      if (!cur || l.news.importance > cur.importance) {
        repByEvent.set(ev, { id: l.news.id, importance: l.news.importance });
      }
    }

    let taken = 0;
    for (const l of links) {
      if (jobs.length >= limit || taken >= perEntity) break;
      const n = l.news;
      if (done.has(n.id)) continue;
      if (n.eventId && repByEvent.get(n.eventId)?.id !== n.id) continue;
      if (
        !isMaterialCandidate({
          importance: n.importance,
          eventType: n.eventType,
          tier: n.tier,
        })
      ) {
        continue;
      }
      // 实测：12 条「material candidate」上 AI 只产出 1 条信号——因为 A 股 PRIMARY 里绝大多数是
      // 募集资金开户 / 监管协议 / 中介核查意见这类程序性文件，模型正确地判定「不触及任何维度」。
      // 复用复盘那套过滤，把 AI 预算花在可能真有料的新闻上。
      if (!isDigestWorthyFiling(n.title)) continue;
      jobs.push({
        entityId: ent.entityId,
        entityName: ent.name,
        dims,
        newsId: n.id,
        title: n.title,
        summary: n.summary,
        eventType: n.eventType,
        publishedAt: n.publishedAt,
      });
      taken++;
    }
  }
  return jobs;
}

async function runJob(j: Job): Promise<number> {
  const cand = candidateDimensions(j.dims, `${j.title}\n${j.summary ?? ""}`);
  const use = cand.length > 0 ? cand : j.dims;
  const signals = await classifyNewsAgainstThesis(
    { title: j.title, summary: j.summary, eventType: j.eventType },
    use,
  );
  for (const s of signals) {
    await db.thesisSignal.upsert({
      where: {
        entityId_newsId_dimensionKey: {
          entityId: j.entityId,
          newsId: j.newsId,
          dimensionKey: s.dimensionKey,
        },
      },
      create: {
        entityId: j.entityId,
        newsId: j.newsId,
        dimensionKey: s.dimensionKey,
        direction: s.direction,
        materiality: s.materiality,
        note: s.note,
        newsTitle: j.title,
        publishedAt: j.publishedAt,
      },
      update: { direction: s.direction, materiality: s.materiality, note: s.note },
    });
  }
  return signals.length;
}

async function main() {
  const limit = num("limit", 200);
  const concurrency = num("concurrency", 6);
  const perEntity = num("per-entity", 12);

  const before = await db.thesisSignal.count();
  console.log(`[signals] 现有信号 ${before} 条，开始攒本轮任务（上限 ${limit}）…`);
  const jobs = await buildJobs(limit, perEntity);
  console.log(`[signals] 本轮 ${jobs.length} 条新闻上 AI，并发 ${concurrency}`);
  if (jobs.length === 0) {
    console.log("[signals] 没有待分类的新闻——该轮为空（正常，说明已追平）");
    return;
  }

  let done = 0;
  let written = 0;
  let failed = 0;
  const started = Date.now();
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      const j = jobs[i];
      if (!j) return;
      try {
        // 不能写成 `written += await runJob(j)`——`+=` 跨 await 是读-改-写，
        // 并发 worker 会互相覆盖（实测进度打出 1→3→1 的非单调数）。先落地再累加。
        const n = await runJob(j);
        written += n;
      } catch (err) {
        failed++;
        console.error(
          `  ✗ ${j.entityName} · ${j.title.slice(0, 18)}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      done++;
      if (done % 25 === 0 || done === jobs.length) {
        const secs = (Date.now() - started) / 1000;
        const eta = done > 0 ? Math.round(((jobs.length - done) * secs) / done / 60) : 0;
        console.log(
          `[signals] ${done}/${jobs.length}｜写入信号 ${written}｜失败 ${failed}｜剩约 ${eta} 分钟`,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const after = await db.thesisSignal.count();
  const dist = await db.$queryRawUnsafe<{ b: string; n: number }[]>(
    `SELECT CASE WHEN materiality<40 THEN '<40' WHEN materiality<60 THEN '40-59'
                 WHEN materiality<80 THEN '60-79' ELSE '>=80' END AS b,
            count(*)::int AS n
     FROM "ThesisSignal" GROUP BY 1 ORDER BY 1`,
  );
  console.log(
    `[signals] 完成：本轮 ${done} 条｜新写信号 ${after - before}｜失败 ${failed}｜库内合计 ${after}`,
  );
  console.log(`[signals] 材料度分布：${dist.map((d) => `${d.b}:${d.n}`).join("  ")}`);
}

main()
  .catch((e) => {
    console.error("[signals] 失败:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
