// 提醒事件生成器：把「派生查询」的三类提醒固化进 AlertEvent（Outbox）。
// 相对导入、tsx 安全（cron 走 tsx，链路不含 ~ 别名）。
//
// 幂等：靠 (userId, dedupeKey) 唯一约束 + createMany skipDuplicates——重跑不重复、被杀了原样续跑。

import type { PrismaClient } from "../../generated/prisma";
import {
  buildAlertEvents,
  type CrossingInput,
  type NewsInput,
  type PriceInput,
} from "../lib/alert-outbox";
import { normalizeAlertPrefs } from "../lib/alert-protocol";
import { normalizeUserDimensions, userDimensionStatus } from "../lib/user-thesis";

/** 生成窗口：只把近 N 小时内**发生**的事实做成事件。挡住历史回填整批变新动态。 */
export const GENERATE_WINDOW_HOURS = 48;
/** 单用户单轮生成上限——首轮不至于一次灌爆 inbox。超出的下轮再补（dedupeKey 保证不重复）。 */
export const MAX_EVENTS_PER_RUN = 20;
/** 与提醒中心同一道重要性闸门。 */
const IMPORTANT_GTE = 55;

export type GenerateStats = {
  users: number;
  drafted: number;
  created: number;
  duplicate: number;
};

type OutboxDb = Pick<
  PrismaClient,
  | "user"
  | "watchlist"
  | "thesisDimensionState"
  | "thesisSignal"
  | "userThesis"
  | "thesisAlertReview"
  | "entity"
  | "newsItem"
  | "priceAlert"
  | "alertEvent"
>;

/**
 * 为一个用户生成事件草稿。三道闸（分类开关 / 维度静音 / 复核负反馈）都在纯逻辑里，
 * 这里只负责取数并把 DB 形状翻译成纯逻辑的输入形状。
 */
async function draftsForUser(
  db: OutboxDb,
  userId: string,
  alertPrefs: unknown,
  since: Date,
) {
  const watched = await db.watchlist.findMany({
    where: { userId },
    select: { entityId: true },
  });
  const ids = watched.map((w) => w.entityId);
  if (ids.length === 0) return [];

  const prefs = normalizeAlertPrefs(alertPrefs);

  const [states, userTheses, reviews, newsRows, priceRows] = await Promise.all([
    db.thesisDimensionState.findMany({
      where: { entityId: { in: ids }, lastCrossAt: { gte: since } },
      orderBy: { lastCrossAt: "desc" },
      select: {
        entityId: true,
        dimensionKey: true,
        lastCrossFrom: true,
        lastCrossTo: true,
        lastCrossNote: true,
        lastCrossNewsId: true,
        lastCrossNewsTitle: true,
        lastCrossAt: true,
      },
    }),
    db.userThesis.findMany({
      where: { userId, entityId: { in: ids } },
      select: { entityId: true, dimensions: true },
    }),
    db.thesisAlertReview.findMany({
      where: { userId, entityId: { in: ids } },
      select: { entityId: true, dimensionKey: true, action: true },
    }),
    db.newsItem.findMany({
      where: {
        importance: { gte: IMPORTANT_GTE },
        entities: { some: { entityId: { in: ids } } },
        publishedAt: { gte: since },
      },
      orderBy: { publishedAt: "desc" },
      take: 40,
      select: {
        id: true,
        title: true,
        brief: true,
        summary: true,
        publishedAt: true,
        tier: true,
        importance: true,
        source: { select: { name: true } },
        // 展示用主体：取用户自选里的那一个
        entities: {
          where: { entityId: { in: ids } },
          take: 1,
          select: { entity: { select: { id: true, name: true } } },
        },
        // 综述判别用：**全部**绑定数，不能用上面过滤后的条数
        _count: { select: { entities: true } },
      },
    }),
    db.priceAlert.findMany({
      where: { userId, active: false, triggeredAt: { gte: since } },
      orderBy: { triggeredAt: "desc" },
      select: {
        id: true,
        direction: true,
        threshold: true,
        triggeredAt: true,
        triggeredPrice: true,
        entity: { select: { id: true, name: true } },
      },
    }),
  ]);

  const entIds = [...new Set(states.map((s) => s.entityId))];
  const ents =
    entIds.length > 0
      ? await db.entity.findMany({
          where: { id: { in: entIds } },
          select: { id: true, name: true },
        })
      : [];
  const nameById = new Map(ents.map((e) => [e.id, e.name]));

  const dimsByEntity = new Map(
    userTheses.map((u) => [
      u.entityId,
      normalizeUserDimensions(u.dimensions as unknown as unknown[]),
    ]),
  );
  // 敏感度闸要用材料度，而 ThesisDimensionState 不存它——回查产生跨越的那条信号
  const crossNewsIds = states
    .map((s) => s.lastCrossNewsId)
    .filter((x): x is string => !!x);
  const sigRows =
    crossNewsIds.length > 0
      ? await db.thesisSignal.findMany({
          where: { entityId: { in: ids }, newsId: { in: crossNewsIds } },
          select: { entityId: true, newsId: true, dimensionKey: true, materiality: true },
        })
      : [];
  const materialityByKey = new Map(
    sigRows.map((r) => [`${r.entityId}::${r.newsId}::${r.dimensionKey}`, r.materiality]),
  );

  const dismissedKeys = new Set(
    reviews
      .filter((r) => r.action === "dismissed")
      .map((r) => `${r.entityId}::${r.dimensionKey}`),
  );

  const crossings: CrossingInput[] = states
    .filter((s) => s.lastCrossAt)
    .map((s) => {
      const dims = dimsByEntity.get(s.entityId);
      const st = dims ? userDimensionStatus(dims, s.dimensionKey) : null;
      return {
        entityId: s.entityId,
        entityName: nameById.get(s.entityId) ?? "",
        dimensionKey: s.dimensionKey,
        fromState: s.lastCrossFrom ?? "neutral",
        toState: s.lastCrossTo ?? "neutral",
        note: s.lastCrossNote ?? "",
        newsId: s.lastCrossNewsId,
        newsTitle: s.lastCrossNewsTitle ?? "",
        crossedAt: s.lastCrossAt!,
        muted: st?.muted ?? false,
        priority: st?.priority ?? false,
        dismissed: dismissedKeys.has(`${s.entityId}::${s.dimensionKey}`),
        materiality:
          materialityByKey.get(
            `${s.entityId}::${s.lastCrossNewsId ?? ""}::${s.dimensionKey}`,
          ) ?? null,
        // 没采纳过 thesis 的实体没有用户敏感度设置 → 用最宽档（40，等同现状），不凭空变严
        threshold: st?.threshold ?? 40,
      };
    });

  const news: NewsInput[] = newsRows.map((n) => ({
    id: n.id,
    title: n.title,
    brief: n.brief,
    summary: n.summary,
    entityId: n.entities[0]?.entity.id ?? null,
    entityName: n.entities[0]?.entity.name ?? "",
    sourceName: n.source.name,
    publishedAt: n.publishedAt,
    tier: n.tier,
    importance: n.importance,
    boundCount: n._count.entities,
  }));

  const priceAlerts: PriceInput[] = priceRows
    .filter((p) => p.triggeredAt && p.triggeredPrice)
    .map((p) => ({
      id: p.id,
      entityId: p.entity.id,
      entityName: p.entity.name,
      direction: p.direction,
      threshold: p.threshold,
      triggeredPrice: p.triggeredPrice!,
      triggeredAt: p.triggeredAt!,
    }));

  return buildAlertEvents({ crossings, news, priceAlerts, prefs }).slice(
    0,
    MAX_EVENTS_PER_RUN,
  );
}

/**
 * 为所有（或指定）用户生成事件并写入 Outbox。
 * `duplicate` = 草稿数 − 实际写入数，即被 dedupeKey 挡下的重复——这个数正常应该很大（每轮大部分是旧事实）。
 */
export async function generateAlertEvents(
  db: OutboxDb,
  opts: { now?: Date; windowHours?: number; userIds?: string[] } = {},
): Promise<GenerateStats> {
  const now = opts.now ?? new Date();
  const windowHours = opts.windowHours ?? GENERATE_WINDOW_HOURS;
  const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);

  const users = await db.user.findMany({
    where: opts.userIds ? { id: { in: opts.userIds } } : {},
    select: { id: true, alertPrefs: true },
  });

  const stats: GenerateStats = {
    users: users.length,
    drafted: 0,
    created: 0,
    duplicate: 0,
  };

  for (const u of users) {
    const drafts = await draftsForUser(db, u.id, u.alertPrefs, since);
    if (drafts.length === 0) continue;
    stats.drafted += drafts.length;
    const res = await db.alertEvent.createMany({
      data: drafts.map((d) => ({
        userId: u.id,
        kind: d.kind,
        dedupeKey: d.dedupeKey,
        entityId: d.entityId,
        title: d.title,
        body: d.body,
        url: d.url,
        payload: d.payload,
        occurredAt: d.occurredAt,
        priority: d.priority,
        offsite: d.offsite,
      })),
      skipDuplicates: true,
    });
    stats.created += res.count;
  }
  stats.duplicate = stats.drafted - stats.created;
  return stats;
}
