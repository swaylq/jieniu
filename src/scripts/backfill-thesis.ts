// 热门股投资逻辑补齐（张楚寒/深度覆盖）：给「重点覆盖」里还没 thesis 的热门股按资讯热度
// 排序、每轮用 deepseek 生成投资逻辑框架，可挂 cron 轮转补齐（「24小时干活」）。
//
// ⚠️生产/本机 AI 必须 deepseek（anthropic/openai 在大陆 403）。用法：
//   secret exec OPENROUTER_API_KEY -- env DATABASE_URL=... SKIP_ENV_VALIDATION=1 \
//     OPENROUTER_MODEL="deepseek/deepseek-chat" npx tsx src/scripts/backfill-thesis.ts [--limit=8]

import { PrismaClient, Prisma } from "../../generated/prisma";
import { generateThesis } from "~/server/ai";
import { HOT_SECTOR_NAMES } from "../lib/hot-universe";
import { IMPORTANT_THRESHOLD } from "../lib/importance";

const db = new PrismaClient();

const DAY = 24 * 60 * 60 * 1000;

/**
 * `--queue=material`：按「近 7 天有重磅资讯、却没有 thesis」挑（不限热门板块）。
 * 依据 effective-coverage.ts 的诊断②——**有重磅=真有料可判断**，比按公司数凑覆盖率靠谱。
 * 不用「资讯多」而用「重磅多」：资讯多可能只是被媒体刷屏，重磅才代表真发生了事。
 */
async function pickByMaterialNews(limit: number) {
  const since = new Date(Date.now() - 7 * DAY);
  const companies = await db.entity.findMany({
    where: { type: "COMPANY", thesis: { is: null } },
    select: { id: true },
  });
  const ids = companies.map((c) => c.id);
  if (ids.length === 0) return [];
  const material = await db.newsEntity.groupBy({
    by: ["entityId"],
    where: {
      entityId: { in: ids },
      news: { publishedAt: { gte: since }, importance: { gte: IMPORTANT_THRESHOLD } },
    },
    _count: { entityId: true },
  });
  material.sort((a, b) => b._count.entityId - a._count.entityId);
  const batch = material.slice(0, limit);
  const rows = await db.entity.findMany({
    where: { id: { in: batch.map((m) => m.entityId) } },
    select: { id: true, name: true, ticker: true },
  });
  const order = new Map(batch.map((m, i) => [m.entityId, i]));
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  console.log(
    `诊断②队列：近7天有重磅(importance≥${IMPORTANT_THRESHOLD})却无 thesis 的公司 ${material.length} 家 → 本轮补最有料的 ${rows.length} 家`,
  );
  return rows;
}

async function sectorNameFor(entityId: string): Promise<string | null> {
  const rel = await db.entityRelation.findFirst({
    where: { fromId: entityId, type: "BELONGS_TO", to: { type: "SECTOR" } },
    select: { to: { select: { name: true } } },
  });
  return rel?.to.name ?? null;
}

/** 生成并入库一批 thesis（两种挑选模式共用）。单家失败只记录、不中断整批。 */
async function runBatch(targets: { id: string; name: string; ticker: string | null }[]) {
  const model = process.env.OPENROUTER_MODEL ?? null;
  let ok = 0;
  for (const e of targets) {
    try {
      const sector = await sectorNameFor(e.id);
      const t = await generateThesis({ name: e.name, ticker: e.ticker, sector });
      const row = {
        summary: t.summary,
        bullCase: t.bullCase,
        bearCase: t.bearCase,
        dimensions: t.dimensions as unknown as Prisma.InputJsonValue,
        catalysts: t.catalysts as unknown as Prisma.InputJsonValue,
        invalidations: t.invalidations as unknown as Prisma.InputJsonValue,
        keyLevels: t.keyLevels,
        model,
      };
      await db.thesis.upsert({
        where: { entityId: e.id },
        create: { entityId: e.id, ...row },
        update: row,
      });
      ok++;
      console.log(`\u2713 ${e.name}\uff08${sector ?? "\u65e0\u677f\u5757"}\uff09: ${t.dimensions.length} \u7ef4\u5ea6`);
    } catch (err) {
      console.error(`\u2717 ${e.name}:`, (err as Error).message);
    }
  }
  console.log(`\n\u5b8c\u6210 ${ok}/${targets.length}`);
  return ok;
}

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : 8;

  // --queue=material：走诊断②优先队列（不限热门板块）
  const queueArg = process.argv.find((a) => a.startsWith("--queue="));
  if (queueArg?.slice("--queue=".length) === "material") {
    const targets = await pickByMaterialNews(Number.isFinite(limit) ? limit : 8);
    if (targets.length === 0) {
      console.log("诊断②队列为空：近7天有重磅却无 thesis 的公司已补齐。");
      return;
    }
    await runBatch(targets);
    return;
  }

  const secs = await db.entity.findMany({
    where: { type: "SECTOR", name: { in: HOT_SECTOR_NAMES } },
    select: { id: true },
  });
  const rels = await db.entityRelation.findMany({
    where: { toId: { in: secs.map((s) => s.id) }, type: "BELONGS_TO", from: { type: "COMPANY" } },
    select: { fromId: true },
  });
  const companyIds = [...new Set(rels.map((r) => r.fromId))];

  const withThesis = new Set(
    (await db.thesis.findMany({ where: { entityId: { in: companyIds } }, select: { entityId: true } })).map(
      (t) => t.entityId,
    ),
  );
  const missing = companyIds.filter((id) => !withThesis.has(id));
  if (missing.length === 0) {
    console.log("热门股 thesis 已全部补齐，无需处理。");
    return;
  }

  // 按近 7 天资讯热度排序——先给最有料/用户最常看的补逻辑
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const heat = await db.newsEntity.groupBy({
    by: ["entityId"],
    where: { entityId: { in: missing }, news: { publishedAt: { gte: since } } },
    _count: { entityId: true },
  });
  const hm = new Map(heat.map((h) => [h.entityId, h._count.entityId]));
  missing.sort((a, b) => (hm.get(b) ?? 0) - (hm.get(a) ?? 0));

  const batch = missing.slice(0, Number.isFinite(limit) ? limit : 8);
  const targets = await db.entity.findMany({
    where: { id: { in: batch } },
    select: { id: true, name: true, ticker: true },
  });
  console.log(
    `热门股缺 thesis ${missing.length} 只 → 本轮补最热的 ${targets.length} 只（deepseek）`,
  );

  await runBatch(targets);
  console.log(`热门股仍缺 ${missing.length} 只待补（本轮已处理 ${targets.length}）。`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
