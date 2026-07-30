import { PrismaClient } from "../../generated/prisma";
import { ensureThesis } from "~/server/thesis-ensure";

/**
 * 全量补齐投资逻辑（2026-07-28）。
 *
 * 背景：5498 家 COMPANY 里只有 166 家有 thesis（3%）。原有 `backfill-thesis.ts` 每轮补 8 家、
 * 每 150 分钟一轮，补完要两个多月。这个脚本一次跑完。
 *
 * 用法（**必须带 secret exec**）：
 *   secret exec OPENROUTER_API_KEY -- env DATABASE_URL="postgresql://mac@localhost:5432/jieniu" \
 *     SKIP_ENV_VALIDATION=1 OPENROUTER_MODEL="deepseek/deepseek-chat" \
 *     npx tsx src/scripts/backfill-all-thesis.ts [--limit=500] [--concurrency=6]
 *
 * 性质（照「回填三律」写的）：
 * - **幂等**：已有 thesis 的直接跳过，被杀了原样重跑即续，不丢进度
 * - **单跑**：只起这一个后台任务，别和别的长回填并发（并发跑会被系统回收）
 * - **按需重排**：优先「有人自选的 → 新闻多的」，让最可能被打开的先有
 */
const db = new PrismaClient();

function num(flag: string, dflt: number): number {
  const a = process.argv.find((x) => x.startsWith(`--${flag}=`));
  const v = a ? Number(a.slice(flag.length + 3)) : NaN;
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

/** 缺 thesis 的公司，按「被自选过 → 关联新闻数」降序——最可能被打开的先补。 */
async function pickTargets(limit: number) {
  return db.$queryRawUnsafe<{ id: string; name: string; watched: bigint; news: bigint }[]>(
    `
    SELECT e.id, e.name,
           (SELECT count(*) FROM "Watchlist" w WHERE w."entityId" = e.id)::bigint  AS watched,
           (SELECT count(*) FROM "NewsEntity" ne WHERE ne."entityId" = e.id)::bigint AS news
    FROM "Entity" e
    WHERE e.type = 'COMPANY'
      AND NOT EXISTS (SELECT 1 FROM "Thesis" t WHERE t."entityId" = e.id)
    ORDER BY watched DESC, news DESC, e.name
    LIMIT $1
  `,
    limit,
  );
}

async function main() {
  const limit = num("limit", 6000);
  const concurrency = num("concurrency", 6);

  const targets = await pickTargets(limit);
  const remaining = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM "Entity" e WHERE e.type='COMPANY'
       AND NOT EXISTS (SELECT 1 FROM "Thesis" t WHERE t."entityId"=e.id)`,
  );
  console.log(
    `[thesis-all] 待补 ${remaining[0]?.n ?? 0} 家，本轮取 ${targets.length} 家，并发 ${concurrency}`,
  );
  if (targets.length === 0) return;

  let done = 0;
  let created = 0;
  let failed = 0;
  const started = Date.now();

  // 简单的固定并发池：N 个 worker 从同一个游标取任务
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      const t = targets[i];
      if (!t) return;
      const r = await ensureThesis(t.id, db);
      done++;
      if (r === "created" || r === "exists") created++;
      else failed++;
      if (done % 25 === 0 || done === targets.length) {
        const secs = (Date.now() - started) / 1000;
        const rate = done / secs;
        const eta = rate > 0 ? Math.round((targets.length - done) / rate / 60) : 0;
        console.log(
          `[thesis-all] ${done}/${targets.length}｜成功 ${created}｜失败 ${failed}｜${rate.toFixed(2)}/s｜剩约 ${eta} 分钟`,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const after = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM "Entity" e WHERE e.type='COMPANY'
       AND NOT EXISTS (SELECT 1 FROM "Thesis" t WHERE t."entityId"=e.id)`,
  );
  console.log(
    `[thesis-all] 完成：本轮 ${done} 家｜成功 ${created}｜失败 ${failed}｜仍缺 ${after[0]?.n ?? 0} 家`,
  );
  // 失败是常态（AI 偶发返回不合规 JSON），下次重跑会自动重试——不当作整体失败
}

main()
  .catch((e) => {
    console.error("[thesis-all] 失败:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
