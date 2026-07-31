import type { PrismaClient } from "../../../generated/prisma";
import { loadMarket } from "./load";
import { fetchShape } from "./limit-shape";
import { runRadar, type RadarResult } from "../../lib/radar/engine";
import { sectorNarrative, stockNarrative } from "../../lib/radar/narrative";
import { expiryFor, advanceSignal } from "../../lib/radar/lifecycle";
import { llmChat } from "../llm";

/**
 * 机会雷达的生成管线：取数 → 引擎 → 一字板核验 → （可选）AI 润色 → 落库 + 生命周期。
 *
 * 分工铁律（需求 §11）：
 *  · 数值、筛选、排序：`lib/radar/engine.ts`，纯函数，零 AI。
 *  · 六段人话：`lib/radar/narrative.ts` 先出**确定性底稿**（数字全来自 metrics）。
 *  · 强模型只做**润色**，且只润色最终入选的 ≤8 条；它改不动任何数字，
 *    失败时底稿原样入库——AI 挂掉页面照常可用（7-24 / 7-25 两次静默事故的教训）。
 */

const AI_SYSTEM = `你是 A 股投研助手，负责把已经算好的机会卡改写得更通俗。

**硬约束（违反即作废）**：
1. 只能使用给你的事实与数字，**一个数字都不许新增、修改、四舍五入或推算**。
2. 不预测涨跌、不给买卖建议、不用"必将/一定/建议买入"这类措辞。
3. 找不到催化时必须照实说"暂无明确催化"，**不许为涨跌编造原因**。
4. 每段控制在 60 字以内，用大白话，不出现分位数、Z-score、评分。
5. **不许改变数字的含义**——"跑赢行业 8 个百分点"不能写成"上涨 8%"，"净流入占成交额 12%"不能写成"上涨 12%"。
6. 严格返回 JSON：{"whyWatch":"","fundStory":"","stage":"","catalyst":"","verify":"","risk":""}`;

/**
 * 润色结果的**机械校验**：成品里出现的每个数字都必须在底稿里出现过。
 *
 * 这道闸是必需的，不是保险——需求 §6 明确「不得为了给涨跌寻找理由而编造因果关系」，
 * 而模型最常见的越界方式就是顺手换个数。含义层面的走样靠提示词与底稿措辞防
 * （底稿把个股涨幅与行业涨幅两个绝对数都写出来），数值层面的新增靠这里挡。
 */
export function numbersAreSubsetOf(polished: string, draft: string): boolean {
  const nums = (t: string) => (t.match(/\d+(?:\.\d+)?/g) ?? []);
  const allowed = new Set(nums(draft));
  return nums(polished).every((n) => allowed.has(n));
}

export function matchesRisk(
  sig: { entityName: string; ticker: string | null },
  risks: { name: string; ticker: string | null }[],
): boolean {
  return risks.some((r) =>
    sig.ticker && r.ticker
      ? r.ticker === sig.ticker
      : !sig.ticker && !r.ticker && r.name === sig.entityName,
  );
}

export type GenerateResult = {
  tradeDate: string | null;
  sectors: number;
  stocks: number;
  risks: number;
  aiPolished: number;
  aiFailed: number;
  expired: number;
  upgraded: number;
  oneWordFiltered: string[];
  diagnostics: RadarResult["diagnostics"];
};

function dateOf(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

async function polish(
  draft: Record<string, string>,
  label: string,
): Promise<Record<string, string> | null> {
  try {
    const raw = await llmChat(
      AI_SYSTEM,
      `标的：${label}\n\n待改写的六段：\n${JSON.stringify(draft, null, 1)}`,
      { tier: "strong", maxTokens: 900, temperature: 0.3 },
    );
    const m = /\{[\s\S]*\}/.exec(raw);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as Record<string, unknown>;
    const out: Record<string, string> = {};
    const wholeDraft = Object.values(draft).join(" ");
    for (const k of Object.keys(draft)) {
      const v = parsed[k];
      const ok =
        typeof v === "string" &&
        v.trim().length > 4 &&
        // 逐段校验：某一段编了数字就只退回那一段，不必作废整张卡
        numbersAreSubsetOf(v, wholeDraft);
      if (typeof v === "string" && v.trim().length > 4 && !ok)
        console.error(`[radar] ${label} 的「${k}」出现底稿里没有的数字，已退回底稿`);
      out[k] = ok ? v.trim() : draft[k]!;
    }
    return out;
  } catch (e) {
    console.error(
      `[radar] AI 润色失败（用确定性底稿）：`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

export async function generateRadar(
  db: PrismaClient,
  opts: { withAI?: boolean; asOf?: string } = {},
): Promise<GenerateResult> {
  const market = await loadMarket(db, { asOf: opts.asOf });
  let result = runRadar(market);

  // ---- 一字板核验（只核最终入选的那几只）---------------------------------
  const oneWordFiltered: string[] = [];
  const shapes = await Promise.all(
    result.stocks.map(async (s) => ({ ticker: s.ticker, shape: await fetchShape(s.ticker) })),
  );
  const limitUps = new Map<string, number>();
  let needRerun = false;
  for (const { ticker, shape } of shapes) {
    if (!shape) continue;
    limitUps.set(ticker, shape.consecutiveLimitUps);
    if (shape.oneWord) {
      const b = market.stockBasics.get(ticker);
      if (b) b.oneWordLimitUp = true;
      oneWordFiltered.push(ticker);
      needRerun = true;
    }
  }
  if (needRerun)
    result = runRadar({ ...market, consecutiveLimitUpsByTicker: limitUps });

  const tradeDate = market.latestTradeDate;
  if (!tradeDate)
    return {
      tradeDate: null,
      sectors: 0,
      stocks: 0,
      risks: 0,
      aiPolished: 0,
      aiFailed: 0,
      expired: 0,
      upgraded: 0,
      oneWordFiltered,
      diagnostics: result.diagnostics,
    };

  // ---- 生命周期：先处理往日信号 -------------------------------------------
  const prev = await db.opportunitySignal.findMany({
    where: { status: { in: ["ACTIVE", "CONFIRMED"] }, tradeDate: { lt: dateOf(tradeDate) } },
  });
  let expired = 0;
  let upgraded = 0;
  const tradeDays = new Map<string, number>();
  {
    const days = await db.$queryRawUnsafe<{ d: Date }[]>(
      `SELECT DISTINCT "tradeDate" d FROM "MarketDaily" ORDER BY d DESC LIMIT 30`,
    );
    days.forEach((r, i) => tradeDays.set(r.d.toISOString().slice(0, 10), i));
  }
  for (const p of prev) {
    const prevKey = p.tradeDate.toISOString().slice(0, 10);
    const elapsed = (tradeDays.get(prevKey) ?? 99) - (tradeDays.get(tradeDate) ?? 0);
    const stillSector = result.sectors.find((s) => s.sector === p.dedupeKey);
    /**
     * 匹配「这条旧信号今天是不是变成追高风险了」。
     *
     * **不能写成 `r.ticker === p.ticker`**：行业级风险与行业级信号的 `ticker` 都是
     * `null`，`null === null` 恒真，于是任何一个行业进了风险名单，**所有**行业的
     * 历史信号都会被打成 RISK。实测「银行」7/28 那条被误判成过热，而它正是 7/30
     * 的头号机会——两条互相矛盾的记录同时存在于库里。
     * 判据改成：个股按 ticker（且两边都非空），行业按名字。
     */
    const stillRisk = matchesRisk(
      { entityName: p.entityName, ticker: p.ticker },
      result.risks,
    );
    const m = p.metrics as Record<string, number | null>;
    const nowMetrics = stillSector?.metrics;
    const adv = advanceSignal(
      {
        signalType: p.signalType as "EARLY" | "CONFIRMED" | "RELATIVE_STRENGTH",
        status: p.status as "ACTIVE" | "CONFIRMED",
        tradeDate: prevKey,
        entityName: p.entityName,
      },
      {
        tradeDaysElapsed: elapsed,
        stillPassesEarly: !!stillSector,
        passesConfirmed: stillSector?.signalType === "CONFIRMED",
        posFlowDays3: nowMetrics?.posFlowDays3 ?? (stillSector ? 2 : 0),
        breadthDrop:
          nowMetrics && typeof m.upShare === "number"
            ? Math.max(0, m.upShare - nowMetrics.upShare)
            : 0,
        severeCrowding: stillRisk,
      },
    );
    if (adv.status !== p.status || adv.signalType !== p.signalType) {
      await db.opportunitySignal.update({
        where: { id: p.id },
        data: {
          status: adv.status,
          signalType: adv.signalType,
          risks: [...(p.risks as string[]), adv.note],
        },
      });
      if (adv.status === "EXPIRED") expired++;
      if (adv.status === "CONFIRMED" && p.signalType === "EARLY") upgraded++;
    }
  }

  // ---- 落库今日信号 -------------------------------------------------------
  const sectorEntities = await db.entity.findMany({
    where: { type: "SECTOR", name: { in: result.sectors.map((s) => s.sector) } },
    select: { id: true, name: true },
  });
  const sectorId = new Map(sectorEntities.map((e) => [e.name, e.id]));

  let aiPolished = 0;
  let aiFailed = 0;

  for (const s of result.sectors) {
    const draft = sectorNarrative(s);
    let narrative: Record<string, string> = { ...draft };
    if (opts.withAI) {
      const p = await polish(draft, `${s.sector}（行业）`);
      if (p) {
        narrative = p;
        aiPolished++;
      } else aiFailed++;
    }
    await db.opportunitySignal.upsert({
      where: { dedupeKey_tradeDate: { dedupeKey: s.sector, tradeDate: dateOf(tradeDate) } },
      create: {
        signalType: s.signalType,
        entityType: "SECTOR",
        entityId: sectorId.get(s.sector) ?? "",
        entityName: s.sector,
        ticker: null,
        sector: s.sector,
        dedupeKey: s.sector,
        signalStrength: s.strength,
        internalScore: s.score,
        reasons: s.reasons,
        risks: s.risks,
        metrics: s.metrics,
        catalystNewsIds: s.catalyst.items.map((i) => i.id),
        narrative,
        tradeDate: dateOf(tradeDate),
        expiresAt: expiryFor(s.signalType, dateOf(tradeDate)),
        status: s.signalType === "CONFIRMED" ? "CONFIRMED" : "ACTIVE",
      },
      update: {
        signalType: s.signalType,
        signalStrength: s.strength,
        internalScore: s.score,
        reasons: s.reasons,
        risks: s.risks,
        metrics: s.metrics,
        catalystNewsIds: s.catalyst.items.map((i) => i.id),
        narrative,
        expiresAt: expiryFor(s.signalType, dateOf(tradeDate)),
        status: s.signalType === "CONFIRMED" ? "CONFIRMED" : "ACTIVE",
      },
    });
  }

  for (const s of result.stocks) {
    const draft = stockNarrative(s);
    let narrative: Record<string, string> = { ...draft };
    if (opts.withAI) {
      const p = await polish(draft, `${s.name}（${s.sector}）`);
      if (p) {
        narrative = p;
        aiPolished++;
      } else aiFailed++;
    }
    await db.opportunitySignal.upsert({
      where: { dedupeKey_tradeDate: { dedupeKey: s.ticker, tradeDate: dateOf(tradeDate) } },
      create: {
        signalType: s.signalType,
        entityType: "COMPANY",
        entityId: s.entityId,
        entityName: s.name,
        ticker: s.ticker,
        sector: s.sector,
        dedupeKey: s.ticker,
        signalStrength: s.strength,
        internalScore: s.score,
        reasons: s.reasons,
        risks: s.risks,
        metrics: s.metrics,
        catalystNewsIds: s.catalyst.items.map((i) => i.id),
        narrative,
        tradeDate: dateOf(tradeDate),
        expiresAt: expiryFor(s.signalType, dateOf(tradeDate)),
        status: "ACTIVE",
      },
      update: {
        signalType: s.signalType,
        signalStrength: s.strength,
        internalScore: s.score,
        reasons: s.reasons,
        risks: s.risks,
        metrics: s.metrics,
        catalystNewsIds: s.catalyst.items.map((i) => i.id),
        narrative,
        expiresAt: expiryFor(s.signalType, dateOf(tradeDate)),
        status: "ACTIVE",
      },
    });
  }

  // 追高风险：不是第四种机会，只是附加标签，单独以 RISK 状态存一份
  for (const r of result.risks.slice(0, 6)) {
    const key = r.ticker ?? r.name;
    await db.opportunitySignal.upsert({
      where: { dedupeKey_tradeDate: { dedupeKey: `risk:${key}`, tradeDate: dateOf(tradeDate) } },
      create: {
        signalType: "EARLY",
        entityType: r.kind === "SECTOR" ? "SECTOR" : "COMPANY",
        entityId: r.entityId ?? (sectorId.get(r.name) ?? ""),
        entityName: r.name,
        ticker: r.ticker,
        sector: r.kind === "SECTOR" ? r.name : null,
        dedupeKey: `risk:${key}`,
        signalStrength: "MEDIUM",
        internalScore: 0,
        reasons: [],
        risks: r.flags,
        metrics: {},
        catalystNewsIds: [],
        narrative: undefined,
        tradeDate: dateOf(tradeDate),
        expiresAt: expiryFor("EARLY", dateOf(tradeDate)),
        status: "RISK",
      },
      update: { risks: r.flags, status: "RISK" },
    });
  }

  return {
    tradeDate,
    sectors: result.sectors.length,
    stocks: result.stocks.length,
    risks: Math.min(result.risks.length, 6),
    aiPolished,
    aiFailed,
    expired,
    upgraded,
    oneWordFiltered,
    diagnostics: result.diagnostics,
  };
}
