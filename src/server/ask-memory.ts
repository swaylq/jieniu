// 「问解牛」的记忆取数（2026-07-29 抽出）。
//
// 原来这段 ~70 行只长在 `routers/ask.ts` 的 `answer` 里；加了流式对话之后
// route handler 也要同一份记忆，与其复制一遍不如抽出来——两边共用一个真相。

import type { PrismaClient } from "../../generated/prisma";
import type { AskMemory } from "~/lib/ask-context";
import { MATERIAL_ALERT_THRESHOLD } from "~/lib/thesis-status";

/** 信号只看最近这么久——太旧的动态对「现在该怎么想」没有参考价值。 */
const SIGNAL_WINDOW_DAYS = 14;

/** 汇总用户四层记忆：画像 / 持仓 / 投资逻辑 / 近期信号 + 决策史。纯取数，不碰 AI。 */
export async function loadAskMemory(
  db: PrismaClient,
  userId: string,
): Promise<AskMemory> {
  const since = new Date(Date.now() - SIGNAL_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [profile, watchRows] = await Promise.all([
    db.investorProfile.findUnique({
      where: { userId },
      select: { style: true, riskLevel: true, summary: true },
    }),
    db.watchlist.findMany({
      where: { userId },
      orderBy: [{ weight: "desc" }, { createdAt: "desc" }],
      select: {
        entityId: true,
        status: true,
        costBasis: true,
        weight: true,
        note: true,
        entity: { select: { name: true, ticker: true } },
      },
    }),
  ]);

  const entityIds = watchRows.map((w) => w.entityId);
  const nameById = new Map(watchRows.map((w) => [w.entityId, w.entity.name]));

  const [theses, signals, decisions] =
    entityIds.length > 0
      ? await Promise.all([
          db.thesis.findMany({
            where: { entityId: { in: entityIds } },
            select: { entityId: true, summary: true },
          }),
          db.thesisSignal.findMany({
            where: {
              entityId: { in: entityIds },
              publishedAt: { gte: since },
              materiality: { gte: MATERIAL_ALERT_THRESHOLD },
            },
            orderBy: { materiality: "desc" },
            take: 12,
            select: {
              entityId: true,
              dimensionKey: true,
              direction: true,
              materiality: true,
              note: true,
            },
          }),
          db.decision.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            take: 5,
            select: { action: true, reason: true, entityId: true },
          }),
        ])
      : [[], [], []];

  return {
    profile: profile ?? null,
    holdings: watchRows.map((w) => ({
      entityId: w.entityId,
      name: w.entity.name,
      ticker: w.entity.ticker,
      status: w.status,
      costBasis: w.costBasis,
      weight: w.weight,
      note: w.note,
    })),
    theses: theses.map((t) => ({
      name: nameById.get(t.entityId) ?? "",
      summary: t.summary,
    })),
    signals: signals.map((s) => ({
      name: nameById.get(s.entityId) ?? "",
      dimensionKey: s.dimensionKey,
      direction: s.direction,
      materiality: s.materiality,
      note: s.note,
    })),
    decisions: decisions.map((d) => ({
      name: nameById.get(d.entityId) ?? "",
      action: d.action,
      reason: d.reason,
    })),
  };
}
