// 热门股投资逻辑补齐（张楚寒/深度覆盖）：给「重点覆盖」里还没 thesis 的热门股按资讯热度
// 排序、每轮用 deepseek 生成投资逻辑框架，可挂 cron 轮转补齐（「24小时干活」）。
//
// ⚠️生产/本机 AI 必须 deepseek（anthropic/openai 在大陆 403）。用法：
//   secret exec OPENROUTER_API_KEY -- env DATABASE_URL=... SKIP_ENV_VALIDATION=1 \
//     OPENROUTER_MODEL="deepseek/deepseek-chat" npx tsx src/scripts/backfill-thesis.ts [--limit=8]

import { PrismaClient, Prisma } from "../../generated/prisma";
import { generateThesis } from "~/server/ai";
import { HOT_SECTOR_NAMES } from "../lib/hot-universe";

const db = new PrismaClient();

async function sectorNameFor(entityId: string): Promise<string | null> {
  const rel = await db.entityRelation.findFirst({
    where: { fromId: entityId, type: "BELONGS_TO", to: { type: "SECTOR" } },
    select: { to: { select: { name: true } } },
  });
  return rel?.to.name ?? null;
}

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : 8;

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
      console.log(`✓ ${e.name}（${sector ?? "无板块"}）: ${t.dimensions.length} 维度`);
    } catch (err) {
      console.error(`✗ ${e.name}:`, (err as Error).message);
    }
  }
  console.log(`\n完成 ${ok}/${targets.length}，热门股仍缺 ${missing.length - ok} 只。`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void db.$disconnect());
