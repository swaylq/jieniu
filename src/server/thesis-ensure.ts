import { generateThesis } from "~/server/ai";
import { db as globalDb } from "~/server/db";
import type { PrismaClient } from "../../generated/prisma";

/**
 * 「按需补齐投资逻辑」——任何个股页被打开时，若还没有 thesis 就现生成一份。
 * 5498 家公司里原本只有 166 家有（3%），靠后台轮转要两个多月才能补完；
 * 而「有人打开」本身就是最好的优先级信号。
 *
 * 幂等 + 单飞（single-flight）：
 * - 先查库，已有直接返回（多个用户同时打开同一页不会重复烧 token）
 * - 进程内以 entityId 为键合并并发请求
 * - upsert 入库，跑到一半被杀也不会写坏
 */
type EnsureDb = Pick<PrismaClient, "entity" | "thesis" | "entityRelation">;

/** 同一实体的并发生成合并成一次。 */
const inflight = new Map<string, Promise<boolean>>();

export type EnsureResult = "exists" | "created" | "skipped" | "failed";

async function sectorNameFor(db: EnsureDb, entityId: string): Promise<string | null> {
  const rel = await db.entityRelation.findFirst({
    where: { fromId: entityId, type: "BELONGS_TO", to: { type: "SECTOR" } },
    select: { to: { select: { name: true } } },
  });
  return rel?.to.name ?? null;
}

async function doGenerate(db: EnsureDb, entityId: string): Promise<boolean> {
  const e = await db.entity.findUnique({
    where: { id: entityId },
    select: { id: true, name: true, ticker: true, type: true, thesis: { select: { id: true } } },
  });
  // 只给公司/股票生成——板块和人物没有「投资逻辑框架」这回事
  if (!e || (e.type !== "COMPANY" && e.type !== "STOCK")) return false;
  if (e.thesis) return true;

  const sector = await sectorNameFor(db, entityId);
  const data = await generateThesis({ name: e.name, ticker: e.ticker, sector });
  await db.thesis.upsert({
    where: { entityId },
    create: {
      entityId,
      summary: data.summary,
      bullCase: data.bullCase,
      bearCase: data.bearCase,
      dimensions: data.dimensions,
      catalysts: data.catalysts ?? [],
      invalidations: data.invalidations ?? [],
      keyLevels: data.keyLevels ?? null,
      model: process.env.OPENROUTER_MODEL ?? null,
    },
    update: {
      summary: data.summary,
      bullCase: data.bullCase,
      bearCase: data.bearCase,
      dimensions: data.dimensions,
      catalysts: data.catalysts ?? [],
      invalidations: data.invalidations ?? [],
      keyLevels: data.keyLevels ?? null,
      model: process.env.OPENROUTER_MODEL ?? null,
    },
  });
  return true;
}

/**
 * 确保某实体有投资逻辑。返回 `created` 表示这次真的生成了。
 * **绝不抛**——它挂在页面渲染链路旁边，AI 抽风不该让整页出错；失败会打日志（不裸 catch）。
 */
export async function ensureThesis(
  entityId: string,
  db: EnsureDb = globalDb,
): Promise<EnsureResult> {
  const existing = await db.thesis.findUnique({
    where: { entityId },
    select: { id: true },
  });
  if (existing) return "exists";

  const running = inflight.get(entityId);
  if (running) {
    // 已有同一实体的生成在跑，等它——不重复烧 token
    const ok = await running.catch(() => false);
    return ok ? "created" : "failed";
  }

  const p = doGenerate(db, entityId).finally(() => inflight.delete(entityId));
  inflight.set(entityId, p);
  try {
    const ok = await p;
    return ok ? "created" : "skipped";
  } catch (err) {
    console.error(
      `[thesis-ensure] ${entityId} 生成失败:`,
      err instanceof Error ? err.message : err,
    );
    return "failed";
  }
}
