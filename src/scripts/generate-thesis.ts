import { PrismaClient, Prisma } from "../../generated/prisma";
import { generateThesis } from "~/server/ai";

/**
 * 为热门公司生成投资逻辑框架并入库（Phase 3 P3-1）。
 * 用法：
 *   secret exec OPENROUTER_API_KEY -- env DATABASE_URL="postgresql://mac@localhost:5432/jieniu" \
 *     SKIP_ENV_VALIDATION=1 OPENROUTER_MODEL="anthropic/claude-sonnet-4.5" \
 *     npx tsx src/scripts/generate-thesis.ts [entityId ...] [--n=5]
 * 不传 entityId 时：按关联新闻数排序取前 N 家 COMPANY（热门股优先）。
 */
const db = new PrismaClient();

async function sectorNameFor(entityId: string): Promise<string | null> {
  const rel = await db.entityRelation.findFirst({
    where: { fromId: entityId, type: "BELONGS_TO", to: { type: "SECTOR" } },
    select: { to: { select: { name: true } } },
  });
  return rel?.to.name ?? null;
}

type Target = { id: string; name: string; ticker: string | null };

async function pickTargets(args: string[]): Promise<Target[]> {
  const ids = args.filter((a) => !a.startsWith("--"));
  if (ids.length > 0) {
    return db.entity.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, ticker: true },
    });
  }
  const nArg = args.find((a) => a.startsWith("--n="));
  const n = nArg ? Number(nArg.slice(4)) : 5;
  const top = await db.newsEntity.groupBy({
    by: ["entityId"],
    _count: { entityId: true },
    orderBy: { _count: { entityId: "desc" } },
    take: 80,
  });
  const rank = new Map(top.map((t, i) => [t.entityId, i]));
  const companies = await db.entity.findMany({
    where: { id: { in: top.map((t) => t.entityId) }, type: "COMPANY" },
    select: { id: true, name: true, ticker: true },
  });
  companies.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  return companies.slice(0, Number.isFinite(n) ? n : 5);
}

async function main() {
  const targets = await pickTargets(process.argv.slice(2));
  console.log(`generating thesis for ${targets.length} companies`);
  const model = process.env.OPENROUTER_MODEL ?? null;
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
      console.log(`✓ ${e.name}（${sector ?? "无板块"}）: ${t.dimensions.length} 维度`);
    } catch (err) {
      console.error(`✗ ${e.name}:`, (err as Error).message);
    }
  }
  await db.$disconnect();
}

void main();
