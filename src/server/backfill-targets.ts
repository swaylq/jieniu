import type { PrismaClient } from "../../generated/prisma";

/** 一只覆盖股的回填目标：代码 + 名字 + 判重范围实体（STOCK 及其发行 COMPANY）+ 当前绑定数。 */
export type BackfillTarget = {
  code: string;
  name: string;
  entityIds: string[];
  bound: number;
};

/**
 * 全部覆盖股，**当前绑定资讯最少的排前面**（自愈：先补最空的，那正是页面看起来最单薄的）。
 * 同一代码可能对应多条实体记录，取绑定最少的那条，避免重复回填同一只股。
 */
export async function targetsByNeed(
  db: PrismaClient,
): Promise<BackfillTarget[]> {
  const stocks = await db.entity.findMany({
    where: { type: "STOCK", ticker: { not: null } },
    select: { id: true, name: true, ticker: true },
  });
  if (stocks.length === 0) return [];

  const issues = await db.entityRelation.findMany({
    where: { type: "ISSUES", toId: { in: stocks.map((s) => s.id) } },
    select: { fromId: true, toId: true },
  });
  const companyByStock = new Map(issues.map((i) => [i.toId, i.fromId]));

  const counts = await db.newsEntity.groupBy({
    by: ["entityId"],
    _count: { entityId: true },
  });
  const boundBy = new Map(counts.map((c) => [c.entityId, c._count.entityId]));

  const byCode = new Map<string, BackfillTarget>();
  for (const s of stocks) {
    const code = s.ticker!;
    const companyId = companyByStock.get(s.id);
    const entityIds = companyId ? [s.id, companyId] : [s.id];
    const bound = entityIds.reduce((n, id) => n + (boundBy.get(id) ?? 0), 0);
    const prev = byCode.get(code);
    if (!prev || bound < prev.bound) {
      byCode.set(code, {
        code,
        name: s.name.replace(/\(.*\)$/, ""),
        entityIds,
        bound,
      });
    }
  }
  return [...byCode.values()].sort((a, b) => a.bound - b.bound);
}

/**
 * 近 sinceDays 天「最热」的 top-K 覆盖股（资讯最多）——供 report/media-refresh 定向刷新热门股，
 * 补 targetsByNeed（冷尾优先）永不选中热门股、其每日新研报/媒体被系统性漏采的缺口
 * （QA loop run 7 发现 / run 44 sway 授权修）。热度 = STOCK 及其发行 COMPANY 的近期资讯数合计；
 * 热度为 0 的不返回（没热度就不必挤占定向刷新名额）。
 */
export async function hotStockTargets(
  db: PrismaClient,
  k: number,
  sinceDays = 7,
): Promise<BackfillTarget[]> {
  const stocks = await db.entity.findMany({
    where: { type: "STOCK", ticker: { not: null } },
    select: { id: true, name: true, ticker: true },
  });
  if (stocks.length === 0) return [];

  const issues = await db.entityRelation.findMany({
    where: { type: "ISSUES", toId: { in: stocks.map((s) => s.id) } },
    select: { fromId: true, toId: true },
  });
  const companyByStock = new Map(issues.map((i) => [i.toId, i.fromId]));

  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const recent = await db.newsEntity.groupBy({
    by: ["entityId"],
    where: { news: { publishedAt: { gte: since } } },
    _count: { entityId: true },
  });
  const heatBy = new Map(recent.map((c) => [c.entityId, c._count.entityId]));

  const byCode = new Map<string, { t: BackfillTarget; heat: number }>();
  for (const s of stocks) {
    const code = s.ticker!;
    const companyId = companyByStock.get(s.id);
    const entityIds = companyId ? [s.id, companyId] : [s.id];
    const heat = entityIds.reduce((n, id) => n + (heatBy.get(id) ?? 0), 0);
    const prev = byCode.get(code);
    if (!prev || heat > prev.heat) {
      byCode.set(code, {
        heat,
        t: { code, name: s.name.replace(/\(.*\)$/, ""), entityIds, bound: 0 },
      });
    }
  }
  return [...byCode.values()]
    .filter((x) => x.heat > 0)
    .sort((a, b) => b.heat - a.heat)
    .slice(0, k)
    .map((x) => x.t);
}

/** 命令行数字参数（--flag=N），缺省或非法则取默认值。 */
export function numArg(flag: string, dflt: number): number {
  const a = process.argv.find((x) => x.startsWith(`--${flag}=`));
  if (!a) return dflt;
  const n = Number(a.slice(flag.length + 3));
  return Number.isFinite(n) ? n : dflt;
}
