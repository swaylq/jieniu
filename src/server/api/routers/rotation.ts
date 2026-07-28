import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  aggregateSectors,
  rankSectors,
  discoverStocks,
  type StockFlow,
} from "~/lib/rotation";

/**
 * 板块轮动 / 个股发现（A 股）。
 *
 * 全部从库里算——`EntitySignal(kind="flow")` 由 `ingest/market-flow.ts` 定时采集。
 * **不在请求路径上碰东财**：它对本节点间歇封锁，且全市场要翻 59 页。
 *
 * 板块归属用解牛自己的 `STOCK --BELONGS_TO--> SECTOR`（140 板块 / 5356 只股），
 * 不借第三方板块口径——全站其它地方用的都是这套。
 */
export const rotationRouter = createTRPCRouter({
  board: publicProcedure
    .input(
      z
        .object({
          sectors: z.number().min(1).max(20).default(5),
          stocks: z.number().min(1).max(20).default(5),
        })
        .default({ sectors: 5, stocks: 5 }),
    )
    .query(async ({ ctx, input }) => {
      const [flowRows, memberRows] = await Promise.all([
        ctx.db.$queryRawUnsafe<
          { id: string; ticker: string; name: string; detail: unknown; asOf: Date }[]
        >(`
          SELECT e.id, e.ticker, e.name, s.detail, s."asOf"
          FROM "EntitySignal" s
          JOIN "Entity" e ON e.id = s."entityId"
          WHERE s.kind = 'flow' AND e.ticker IS NOT NULL
        `),
        ctx.db.$queryRawUnsafe<
          { ticker: string; sector: string; sectorId: string }[]
        >(`
          SELECT st.ticker, sec.name AS sector, sec.id AS "sectorId"
          FROM "EntityRelation" r
          JOIN "Entity" st  ON st.id  = r."fromId" AND st.type  = 'STOCK'
          JOIN "Entity" sec ON sec.id = r."toId"   AND sec.type = 'SECTOR'
          WHERE r.type = 'BELONGS_TO' AND st.ticker IS NOT NULL
        `),
      ]);

      const flows: StockFlow[] = [];
      const entityIdByCode = new Map<string, string>();
      let asOf: Date | null = null;
      for (const r of flowRows) {
        const d = r.detail as Record<string, unknown> | null;
        if (!d || typeof d !== "object") continue;
        const changePct = typeof d.changePct === "number" ? d.changePct : null;
        const netInflow = typeof d.netInflow === "number" ? d.netInflow : null;
        const price = typeof d.price === "number" ? d.price : null;
        if (changePct === null || netInflow === null || price === null) continue;
        flows.push({
          code: r.ticker,
          name: r.name,
          price,
          changePct,
          netInflow,
          inflowRatio: typeof d.inflowRatio === "number" ? d.inflowRatio : 0,
        });
        entityIdByCode.set(r.ticker, r.id);
        if (!asOf || r.asOf > asOf) asOf = r.asOf;
      }

      // 一只股可能挂多个板块；取第一个（库里绝大多数是一对一，多的那几只不影响排序）。
      const membership = new Map<string, string>();
      const sectorId = new Map<string, string>();
      for (const m of memberRows) {
        if (!membership.has(m.ticker)) membership.set(m.ticker, m.sector);
        if (!sectorId.has(m.sector)) sectorId.set(m.sector, m.sectorId);
      }

      const ranked = rankSectors(
        aggregateSectors(flows, membership),
        input.sectors,
      );
      const discoveries = discoverStocks(
        flows,
        membership,
        ranked,
        input.stocks,
      );

      return {
        asOf,
        covered: flows.length,
        sectors: ranked.map((r) => ({ ...r, sectorId: sectorId.get(r.sector) ?? null })),
        discoveries: discoveries.map((d) => ({
          ...d,
          sectorId: sectorId.get(d.sector) ?? null,
          entityId: entityIdByCode.get(d.code) ?? null,
        })),
      };
    }),
});
