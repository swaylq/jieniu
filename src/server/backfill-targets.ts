import type { PrismaClient } from "../../generated/prisma";

/** 一只覆盖股的回填目标：代码 + 名字 + 判重范围实体（STOCK 及其发行 COMPANY）+ 当前绑定数。 */
export type BackfillTarget = {
  code: string;
  name: string;
  entityIds: string[];
  bound: number;
  /** 还在交易（有资金流信号）或历史上有过资讯——退市死壳两者皆无，见 `targetsByNeed`。 */
  alive?: boolean;
};

export type TargetsOpts = {
  /**
   * 被剔除的只数（退市死壳 + 被 `market` 过滤掉的）。**必须有人接**——所有调用方都是
   * `.slice(0, N)`，静默剔除会让「队头是什么」变成看不见的状态（2026-07-30 事故就是没人看得见）。
   */
  onSkip?: (skipped: number) => void;
  /**
   * 只要某个市场的标的。`"A"` = A 股六位代码。
   *
   * 为什么需要：清掉死壳后队头立刻变成美股（TXN / PDD / ASML —— 它们绑定数天然最少），
   * 而 `backfill-reports` / `backfill-new` / ingest 的研报刷新走的是**东财 A 股**接口
   * （`eastmoneyReportsForCodes` / `eastmoneyAnnForCodes`），喂美股代码同样一条都取不到。
   * 不加这个过滤，等于把空转从「捞死壳」平移成「捞美股」——同一个 bug 换了个位置。
   */
  market?: "A";
};

/**
 * 全部覆盖股，**当前绑定资讯最少的排前面**（自愈：先补最空的，那正是页面看起来最单薄的）。
 * 同一代码可能对应多条实体记录，取绑定最少的那条，避免重复回填同一只股。
 *
 * **退市死壳一律剔除**（2026-07-30 事故）：81 只已退市的壳恒为 `bound=0`，稳定压在队头，
 * 而全部 5 条补料路径（ingest 的研报/媒体刷新、backfill-announcements / -reports / -media / -year）
 * 都是 `.slice(0, N)` 取队头 —— 于是每轮都在捞同一批捞不到东西的壳，自 7-26 起 100% 空转，
 * 而每一轮的退出码都是 0，覆盖率巡检也只报「近 7 天占比 49%」这种看不出病因的数字。
 *
 * 判据是**「有资金流信号（在交易）」**，A 股六位代码之外的实体（美股 NVDA / TSM / 美光…
 * 压根不在 A 股资金流快照里）直接算活。这个判据是试错出来的，两条错路都记下来：
 *
 * - ✗ **按名字**：队头 40 只里「玉龙股份」「广汽长丰」「太行水泥」「外运发展」都是死壳，
 *   却不含「退 / ST / *」——名字判据只覆盖 31/40。
 * - ✗ **按「历史上有过绑定」**：「中国北车」「武钢股份」「上实医药」这些早年吸并退市的股
 *   各有 2~10 条陈年绑定，照样混进队头，改完队头 40 只里仍只有 2 个实体在交易。
 * - ✗ **按「近 90 天有过资讯」**：看着最合理，实际**这个信号本身是被污染的**——退市旧实体是
 *   误绑磁石。实测队头的绑定逐条看：「美的电器」←「南疆中亚家博城奠基」、「招商地产」←
 *   「厦门建发竞得前海宅地」、「邯郸钢铁」←「燕赵大地创新涌动」、「金马集团(000602)」←
 *   山东那家同名金马集团。拿它当「活着」的证据，等于让误绑替死壳作证。
 * - ✓ **按资金流**：`EntitySignal.kind='flow'` 来自东财 clist（当前挂牌股全集），每天随行情
 *   刷新。退市股不在里面，且这是个**动态**判据而非黑名单——某只壳恢复上市，下一轮自动回队头。
 *
 * 代价说清楚：刚上市、还没进当日资金流快照的 A 股会被跳过一轮（快照一天刷多次，小时级自愈）。
 * 用 `onSkip` 把跳过数打出来，别让它变成看不见的降级。
 */
const A_SHARE_CODE = /^\d{6}$/;
export async function targetsByNeed(
  db: PrismaClient,
  { onSkip, market }: TargetsOpts = {},
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

  const flows = await db.entitySignal.findMany({
    where: { kind: "flow" },
    select: { entityId: true },
  });
  const trading = new Set(flows.map((f) => f.entityId));

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
        alive:
          !A_SHARE_CODE.test(code) || entityIds.some((id) => trading.has(id)),
      });
    }
  }
  const all = [...byCode.values()];
  const keep = all.filter(
    (t) => t.alive && (market !== "A" || A_SHARE_CODE.test(t.code)),
  );
  onSkip?.(all.length - keep.length);
  return keep.sort((a, b) => a.bound - b.bound);
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
