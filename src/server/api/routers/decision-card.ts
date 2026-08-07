import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { parseConsensusDetail } from "~/lib/consensus";
import { OPERATING_DAYS, type CardEvent } from "~/lib/decision-card";
import type { RadarBar } from "~/lib/radar/series";
// 配对解析复用 `earnings` 里那份（`Thesis` 挂 COMPANY、行情/信号挂 STOCK 的同一套规则），
// 不另写一份——两份迟早会漂。
import { resolvePair } from "~/server/api/routers/earnings";

/**
 * 「个股决策卡」的**市场侧**输入（趋势/资金、结构化事件、一致预期、解禁、融资）。
 *
 * 用户侧输入（我的维度 / 逻辑信号 / 到价提醒）个股页本来就已经取了，不在这里重复查——
 * 那些查询已经在页面那一个 `Promise.all` 里，再查一遍纯属浪费。这个 procedure
 * 也**必须**加进同一个 `Promise.all`：每多一道串行波就多一次全额延迟（个股页 278ms
 * 那轮的教训），它自己内部也是一次并行取数，不串。
 *
 * 全部读**配对两侧**（COMPANY ↔ STOCK）：行情与结构化信号挂 STOCK，投资逻辑挂 COMPANY，
 * 只查单边会让公司页的趋势/资金/估值三个模型集体「数据不足」——那是数据没接上，
 * 不是真的没数据，摆出来就是撒谎。
 */

/** 趋势模型要 20 日动量 + 60 日均线，取 80 根留出停牌/缺口的余量。 */
const BAR_LIMIT = 80;

export const decisionCardRouter = createTRPCRouter({
  marketInputs: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const pair = await resolvePair(ctx.db, input.id);
      if (!pair)
        return {
          bars: [] as RadarBar[],
          events: [] as CardEvent[],
          consensus: null,
          unlock: null,
          margin: null,
        };

      const since = new Date(Date.now() - OPERATING_DAYS * 86_400_000);
      const [rawBars, links, signals] = await Promise.all([
        ctx.db.marketDaily.findMany({
          where: { entityId: { in: pair.ids } },
          orderBy: { tradeDate: "desc" },
          take: BAR_LIMIT,
          select: {
            tradeDate: true,
            close: true,
            changePct: true,
            amount: true,
            netAmount: true,
            netRatio: true,
            turnoverRate: true,
          },
        }),
        ctx.db.newsEntity.findMany({
          where: {
            entityId: { in: pair.ids },
            news: { publishedAt: { gte: since }, eventType: { not: null } },
          },
          orderBy: { news: { publishedAt: "desc" } },
          take: 120,
          select: {
            news: {
              select: {
                id: true,
                title: true,
                tier: true,
                eventType: true,
                publishedAt: true,
              },
            },
          },
        }),
        ctx.db.entitySignal.findMany({
          where: {
            entityId: { in: pair.ids },
            kind: { in: ["consensus", "unlock", "margin"] },
          },
          select: { kind: true, detail: true, asOf: true },
          orderBy: { asOf: "desc" },
        }),
      ]);

      // 日线按交易日升序（`radar/series` 的约定），配对两侧同一天各有一行时只留一行。
      const seen = new Set<string>();
      const bars: RadarBar[] = [];
      for (const r of [...rawBars].reverse()) {
        const day = isoDay(r.tradeDate);
        if (seen.has(day)) continue;
        seen.add(day);
        bars.push({
          day,
          close: r.close,
          changePct: r.changePct,
          amount: r.amount,
          netAmount: r.netAmount,
          netRatio: r.netRatio,
          turnoverRate: r.turnoverRate,
        });
      }

      // 同一条资讯可能同时绑到 COMPANY 与 STOCK 上——按 newsId 去重，否则事件数会翻倍，
      // 风险模型「3 条以上加 2 分」的门槛会被这份重复直接顶穿。
      const byNews = new Map<string, CardEvent>();
      for (const l of links) {
        const n = l.news;
        if (!n.eventType || byNews.has(n.id)) continue;
        byNews.set(n.id, {
          eventType: n.eventType,
          title: n.title,
          tier: n.tier,
          newsId: n.id,
          publishedAt: n.publishedAt,
        });
      }

      const pick = (kind: string) => signals.find((s) => s.kind === kind);
      const consensusRow = pick("consensus");
      const parsed = consensusRow
        ? parseConsensusDetail(consensusRow.detail)
        : null;

      return {
        bars,
        events: [...byNews.values()],
        consensus: parsed ? { ...parsed, asOf: consensusRow!.asOf } : null,
        unlock: parseUnlock(pick("unlock")?.detail),
        margin: parseMargin(pick("margin")?.detail),
      };
    }),
});

/** `tradeDate` 是 `@db.Date`，本地时区取日历日（走 UTC 会把 8/6 写成 8/5）。 */
function isoDay(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseUnlock(
  detail: unknown,
): { freeDate: string; ratio: number; type: string } | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail))
    return null;
  const d = detail as Record<string, unknown>;
  const freeDate = typeof d.freeDate === "string" ? d.freeDate.slice(0, 10) : "";
  const ratio = num(d.ratio);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(freeDate) || ratio === null) return null;
  return {
    freeDate,
    ratio,
    type: typeof d.type === "string" && d.type ? d.type : "限售股",
  };
}

function parseMargin(
  detail: unknown,
): { rzye: number; zb: number } | null {
  if (!detail || typeof detail !== "object" || Array.isArray(detail))
    return null;
  const d = detail as Record<string, unknown>;
  const rzye = num(d.rzye);
  const zb = num(d.rzyezb);
  if (rzye === null || zb === null) return null;
  return { rzye, zb };
}
