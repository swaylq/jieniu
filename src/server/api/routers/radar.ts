import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import type { CardNarrative } from "~/lib/radar/narrative";

/**
 * 机会雷达 + 市场强弱地图。
 *
 * 两个模块是**刻意分开**的（需求 §1）：
 *  · `strengthMap` 只回答「今天哪些行业强、哪些弱」，**不把强势或跌得多的行业叫机会**；
 *  · `opportunities` 只出真正过闸的信号，回答「哪些变化可能仍处于早期」。
 *
 * 全部读库、零外部请求：信号由 `src/scripts/generate-radar.ts` 定时算好落库
 * （渲染时现算要扫 5300 只股 × 60 天，那是后台作业的活，不是请求路径的活）。
 */

export type RadarCard = {
  id: string;
  kind: "SECTOR" | "STOCK";
  signalType: "EARLY" | "CONFIRMED" | "RELATIVE_STRENGTH";
  strength: "STRONG" | "MEDIUM";
  name: string;
  ticker: string | null;
  sector: string | null;
  entityId: string | null;
  narrative: CardNarrative | null;
  reasons: string[];
  risks: string[];
  metrics: Record<string, number | boolean | null>;
  evidence: {
    id: string;
    title: string;
    url: string;
    sourceName: string;
    publishedAt: Date;
  }[];
  generatedAt: Date;
  expiresAt: Date;
  status: string;
};

export const radarRouter = createTRPCRouter({
  /**
   * 市场强弱地图：板块涨跌、上涨/下跌家数、成交额、主力资金。
   * 直接从 `MarketDaily` 聚合最新交易日——不依赖东财实时接口（它对本节点间歇封锁）。
   */
  strengthMap: publicProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.$queryRawUnsafe<
      {
        sector: string;
        sectorId: string;
        members: bigint;
        up: bigint;
        down: bigint;
        avgChangePct: number;
        amount: number | null;
        netAmount: number | null;
        tradeDate: Date;
      }[]
    >(`
      WITH latest AS (SELECT max("tradeDate") d FROM "MarketDaily"),
      j AS (
        SELECT sec.name AS sector, sec.id AS "sectorId", m."changePct", m.amount, m."netAmount", m."tradeDate"
          FROM "MarketDaily" m
          JOIN "EntityRelation" r ON r."fromId" = m."entityId" AND r.type = 'BELONGS_TO'
          JOIN "Entity" sec ON sec.id = r."toId" AND sec.type = 'SECTOR'
         WHERE m."tradeDate" = (SELECT d FROM latest)
      )
      SELECT sector, "sectorId", count(*) members,
             count(*) FILTER (WHERE "changePct" > 0) up,
             count(*) FILTER (WHERE "changePct" < 0) down,
             avg("changePct") "avgChangePct",
             sum(amount) amount, sum("netAmount") "netAmount",
             max("tradeDate") "tradeDate"
        FROM j GROUP BY 1,2 HAVING count(*) >= 5
       ORDER BY avg("changePct") DESC
    `);
    return {
      tradeDate: rows[0]?.tradeDate ?? null,
      sectors: rows.map((r) => ({
        sector: r.sector,
        sectorId: r.sectorId,
        members: Number(r.members),
        up: Number(r.up),
        down: Number(r.down),
        avgChangePct: r.avgChangePct,
        amount: r.amount,
        netAmount: r.netAmount,
      })),
    };
  }),

  /** 今日机会信号（ACTIVE / CONFIRMED）+ 追高风险标签。空是合法输出。 */
  opportunities: publicProcedure.query(async ({ ctx }) => {
    const latest = await ctx.db.opportunitySignal.findFirst({
      orderBy: { tradeDate: "desc" },
      select: { tradeDate: true },
    });
    if (!latest) return { tradeDate: null, cards: [], risks: [] };

    const rows = await ctx.db.opportunitySignal.findMany({
      where: { tradeDate: latest.tradeDate },
      orderBy: { internalScore: "desc" },
    });

    const newsIds = rows.flatMap((r) => r.catalystNewsIds as string[]);
    const news = newsIds.length
      ? await ctx.db.newsItem.findMany({
          where: { id: { in: newsIds } },
          select: {
            id: true,
            title: true,
            url: true,
            publishedAt: true,
            source: { select: { name: true } },
          },
        })
      : [];
    const newsById = new Map(news.map((n) => [n.id, n]));

    const toCard = (r: (typeof rows)[number]): RadarCard => ({
      id: r.id,
      kind: r.entityType === "SECTOR" ? "SECTOR" : "STOCK",
      signalType: r.signalType as RadarCard["signalType"],
      strength: r.signalStrength as RadarCard["strength"],
      name: r.entityName,
      ticker: r.ticker,
      sector: r.sector,
      entityId: r.entityId || null,
      narrative: (r.narrative as CardNarrative | null) ?? null,
      reasons: (r.reasons as string[]) ?? [],
      risks: (r.risks as string[]) ?? [],
      metrics: (r.metrics as Record<string, number | boolean | null>) ?? {},
      evidence: (r.catalystNewsIds as string[])
        .map((id) => newsById.get(id))
        .filter((n): n is NonNullable<typeof n> => !!n)
        .map((n) => ({
          id: n.id,
          title: n.title,
          url: n.url,
          sourceName: n.source.name,
          publishedAt: n.publishedAt,
        })),
      generatedAt: r.generatedAt,
      expiresAt: r.expiresAt,
      status: r.status,
    });

    return {
      tradeDate: latest.tradeDate,
      cards: rows
        .filter((r) => r.status === "ACTIVE" || r.status === "CONFIRMED")
        .map(toCard),
      // 追高风险不是第四种机会，是附加标签——单独一段，不混进机会列表
      risks: rows
        .filter((r) => r.status === "RISK")
        .map((r) => ({
          name: r.entityName,
          entityId: r.entityId || null,
          flags: (r.risks as string[]) ?? [],
        })),
    };
  }),
});
