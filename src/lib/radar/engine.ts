/**
 * 机会雷达引擎——把逐日行情/资金聚合成信号（纯函数、无 IO、无 AI、可测）。
 *
 * 需求 §11 的分工在这里落地：**数值计算、筛选、排序全部由程序完成**。
 * 大模型在这一层之外，只对最终入选的 ≤8 条生成通俗解释，改不了任何数字。
 *
 * 流程：
 *   全市场逐日序列
 *     → 全 A 基准 + 板块聚合（aggregate.ts）
 *     → 横截面分位 → 资金强度（score.ts §3）
 *     → 三道闸门（gates.ts §2）
 *     → 机会分 + 拥挤惩罚（score.ts §4/§5/§7）
 *     → 配额与去重（select.ts §1/§5）
 *
 * 「今天没有信号」是**合法输出**。`diagnostics` 存在的意义是让"确实没有"
 * 和"数据没到"能分开——否则上游断供会伪装成"今天市场很平静"。
 */

import {
  aggregateSector,
  marketBenchmark,
  sectorRankUp,
  isLimitUp,
  atOffset,
  MIN_MEMBERS,
  type StockSeries,
  type SectorAggregate,
  type MarketBenchmark,
} from "./aggregate";
import {
  returnOverDays,
  positiveFlowDays,
  netFlowSum,
  amountRatioVs,
  percentileRank,
  selfPercentile,
  mean,
  clamp100,
  type RadarBar,
} from "./series";
import {
  fundStrengthScore,
  catalystScore,
  crowding,
  sectorOpportunityScore,
  stockOpportunityScore,
  strengthLabel,
  type CatalystGrade,
  type SignalStrength,
  type Crowding,
} from "./score";
import {
  earlyGate,
  confirmedGate,
  relativeStrengthGate,
  limitUpGate,
} from "./gates";
import { baseFilter, selectOpportunities, type StockBasics } from "./select";
import type { CatalystPick } from "./catalyst";

export type EngineInput = {
  /** 全市场个股逐日序列（升序） */
  stocks: StockSeries[];
  stockBasics: Map<string, StockBasics>;
  catalystsBySector: Map<string, CatalystPick>;
  catalystsByTicker: Map<string, CatalystPick>;
  /** 流通市值（元）。有就给资金强度加一项「净流入/流通市值」（§3） */
  floatCapByTicker?: Map<string, number>;
  /** 已确认为连续涨停的股票（由 K 线核过），进不了机会列表 */
  consecutiveLimitUpsByTicker?: Map<string, number>;
};

const EMPTY_CATALYST: CatalystPick = {
  grade: "NONE",
  items: [],
  emptyNote: "暂无明确催化，属于资金与价格异动，仍需验证。",
};

export type SectorMetrics = {
  members: number;
  avgChangePct: number;
  up: number;
  down: number;
  upShare: number;
  upShareAvg5: number | null;
  limitUpShare: number;
  ret3: number | null;
  ret5: number | null;
  ret20: number | null;
  mkt3: number | null;
  mkt5: number | null;
  mkt20: number | null;
  netAmountToday: number | null;
  netRatioToday: number | null;
  netFlow3: number | null;
  netFlow5: number | null;
  posFlowDays3: number;
  posFlowDays5: number;
  amountToday: number | null;
  amountRatio20: number | null;
  top2Concentration: number | null;
  top3Concentration: number | null;
  fundScore: number;
  fundPct: number;
  selfAnomalyPct: number | null;
  rankUp: number | null;
  coverage20: number;
};

export type SectorDraft = {
  signalType: "EARLY" | "CONFIRMED";
  sector: string;
  score: number;
  strength: SignalStrength;
  reasons: string[];
  risks: string[];
  metrics: SectorMetrics;
  catalyst: CatalystPick;
  leaders: SectorAggregate["leaders"];
};

export type StockMetrics = {
  changePct: number;
  ret3: number | null;
  ret5: number | null;
  ret20: number | null;
  sectorRet3: number | null;
  sectorRet5: number | null;
  mkt3: number | null;
  excessOverSector3: number | null;
  netAmountToday: number | null;
  netRatioToday: number | null;
  netFlow3: number | null;
  posFlowDays3: number;
  posFlowDays5: number;
  amountToday: number | null;
  amountRatio20: number | null;
  avgAmount20: number | null;
  fundScore: number;
  fundPctInSector: number;
  selfAnomalyPct: number | null;
  limitUpToday: boolean;
  consecutiveLimitUps: number;
};

export type StockDraft = {
  signalType: "EARLY" | "CONFIRMED" | "RELATIVE_STRENGTH";
  ticker: string;
  entityId: string;
  name: string;
  sector: string;
  score: number;
  strength: SignalStrength;
  reasons: string[];
  risks: string[];
  metrics: StockMetrics;
  catalyst: CatalystPick;
  fromUnselectedSector: boolean;
};

export type RiskDraft = {
  kind: "SECTOR" | "STOCK";
  name: string;
  ticker: string | null;
  entityId: string | null;
  flags: string[];
};

export type Diagnostics = {
  stocksLoaded: number;
  stocksWithSector: number;
  sectorsEvaluated: number;
  sectorsPassedEarly: number;
  sectorsPassedConfirmed: number;
  sectorsBelowScore: number;
  sectorsCrowded: number;
  stockCandidates: number;
  stocksFilteredOut: number;
  stocksBelowScore: number;
  relativeStrengthPassed: number;
  benchmark: MarketBenchmark;
};

export type RadarResult = {
  sectors: SectorDraft[];
  stocks: StockDraft[];
  risks: RiskDraft[];
  diagnostics: Diagnostics;
};

/** 5 日资金持续性的原始度量：正流入天数 + 净额合计的符号强度。 */
function persistenceRaw(bars: RadarBar[]): number {
  const days = positiveFlowDays(bars, 5);
  const sum = netFlowSum(bars, 5) ?? 0;
  return days * 20 + (sum > 0 ? 10 : 0);
}

export function runRadar(input: EngineInput): RadarResult {
  const { stocks } = input;
  const benchmark = marketBenchmark(stocks);

  // ---- 板块聚合 -----------------------------------------------------------
  const bySector = new Map<string, StockSeries[]>();
  for (const s of stocks) {
    if (!s.sector) continue;
    const arr = bySector.get(s.sector);
    if (arr) arr.push(s);
    else bySector.set(s.sector, [s]);
  }
  const aggs: SectorAggregate[] = [];
  for (const [sector, members] of bySector) {
    const a = aggregateSector(sector, members);
    if (a) aggs.push(a);
  }

  // ---- 横截面分位（§3：绝不按"多少亿"直接排名）---------------------------
  const absSample = aggs
    .map((a) => a.netAmountToday)
    .filter((v): v is number => v !== null);
  const ratioSample = aggs
    .map((a) => a.netRatioToday)
    .filter((v): v is number => v !== null);
  const persistSample = aggs.map((a) => persistenceRaw(a.synthetic));

  const fundOf = new Map<string, { score: number; anomaly: number | null }>();
  for (const a of aggs) {
    const anomaly = selfPercentile(a.synthetic, (b) => b.netAmount, 60, 20);
    fundOf.set(a.sector, {
      score: fundStrengthScore({
        absPct: percentileRank(absSample, a.netAmountToday ?? 0),
        ratioPct: percentileRank(ratioSample, a.netRatioToday ?? 0),
        floatPct: null, // 板块层面没有稳定的"流通市值"口径，只在个股层用
        anomalyPct: anomaly ?? 50,
        persistPct: percentileRank(persistSample, persistenceRaw(a.synthetic)),
      }),
      anomaly,
    });
  }
  const fundScoreSample = [...fundOf.values()].map((v) => v.score);

  // 3 个交易日前的强弱排名（「刚刚启动」第④条的备选判据）
  const nowRet3 = new Map<string, number>();
  const thenRet3 = new Map<string, number>();
  for (const [sector, members] of bySector) {
    const now = mean(
      members
        .map((m) => returnOverDays(m.bars, 3))
        .filter((v): v is number => v !== null),
    );
    const then = mean(
      members
        .map((m) => returnOverDays(atOffset(m.bars, 3), 3))
        .filter((v): v is number => v !== null),
    );
    if (now !== null) nowRet3.set(sector, now);
    if (then !== null) thenRet3.set(sector, then);
  }

  // ---- 逐板块过闸 ---------------------------------------------------------
  const sectorDrafts: SectorDraft[] = [];
  const risks: RiskDraft[] = [];
  let passedEarly = 0;
  let passedConfirmed = 0;
  let belowScore = 0;
  let crowdedCount = 0;

  const sectorCrowd = new Map<string, Crowding>();
  const sectorMetrics = new Map<string, SectorMetrics>();

  for (const a of aggs) {
    const fund = fundOf.get(a.sector)!;
    const fundPct = percentileRank(fundScoreSample, fund.score);
    const crowd = crowding({
      scope: "SECTOR",
      ret5: a.ret5,
      ret20: a.ret20,
      amountRatio20: a.amountRatio20,
      limitUpShare: a.limitUpShare,
      priceUpFlowOut: a.priceUpFlowOut,
      topConcentration: a.top3Concentration,
    });
    sectorCrowd.set(a.sector, crowd);

    const m: SectorMetrics = {
      members: a.members,
      avgChangePct: a.avgChangePct,
      up: a.up,
      down: a.down,
      upShare: a.upShare,
      upShareAvg5: a.upShareAvg5,
      limitUpShare: a.limitUpShare,
      ret3: a.ret3,
      ret5: a.ret5,
      ret20: a.ret20,
      mkt3: benchmark.ret3,
      mkt5: benchmark.ret5,
      mkt20: benchmark.ret20,
      netAmountToday: a.netAmountToday,
      netRatioToday: a.netRatioToday,
      netFlow3: a.netFlow3,
      netFlow5: a.netFlow5,
      posFlowDays3: a.posFlowDays3,
      posFlowDays5: a.posFlowDays5,
      amountToday: a.amountToday,
      amountRatio20: a.amountRatio20,
      top2Concentration: a.top2Concentration,
      top3Concentration: a.top3Concentration,
      fundScore: fund.score,
      fundPct,
      selfAnomalyPct: fund.anomaly,
      rankUp: sectorRankUp(a.sector, nowRet3, thenRet3),
      coverage20: a.coverage20,
    };
    sectorMetrics.set(a.sector, m);

    if (crowd.severe) {
      crowdedCount++;
      risks.push({
        kind: "SECTOR",
        name: a.sector,
        ticker: null,
        entityId: null,
        flags: crowd.flags,
      });
      continue;
    }

    const gateInput = {
      fundPct,
      selfAnomalyPct: fund.anomaly,
      posFlowDays3: a.posFlowDays3,
      posFlowDays5: a.posFlowDays5,
      upShare: a.upShare,
      upShareAvg5: a.upShareAvg5,
      ret3: a.ret3,
      ret5: a.ret5,
      ret20: a.ret20,
      mkt3: benchmark.ret3,
      mkt5: benchmark.ret5,
      rankUp: m.rankUp,
      amountRatio20: a.amountRatio20,
      top3Concentration: a.top3Concentration,
      top2Concentration: a.top2Concentration,
      severeCrowding: false,
    };
    const conf = confirmedGate(gateInput);
    const early = earlyGate(gateInput);
    // 趋势形成优先：同时满足时它是更强的描述
    const hit = conf.pass ? conf : early.pass ? early : null;
    if (!hit) continue;
    const signalType = conf.pass ? "CONFIRMED" : "EARLY";
    if (conf.pass) passedConfirmed++;
    else passedEarly++;

    const cat = input.catalystsBySector.get(a.sector) ?? EMPTY_CATALYST;
    const relStrength =
      a.ret3 !== null && benchmark.ret3 !== null
        ? clamp100(50 + (a.ret3 - benchmark.ret3) * 12)
        : 50;
    const breadthScore = clamp100(
      a.upShare * 100 * 0.6 +
        (a.upShareAvg5 !== null
          ? clamp100(50 + (a.upShare - a.upShareAvg5) * 200) * 0.4
          : 20),
    );
    // 数据异常惩罚：20 日窗口覆盖不到一半成分股时，这条信号的可信度打折
    const dataPenalty =
      a.coverage20 < a.members * 0.5 ? 15 : a.coverage20 < a.members * 0.8 ? 5 : 0;
    const score = sectorOpportunityScore({
      fund: fund.score,
      relStrength,
      breadth: breadthScore,
      persistence: clamp100(a.posFlowDays5 * 20),
      catalyst: catalystScore(cat.grade),
      crowdPenalty: crowd.penalty,
      dataPenalty,
    });
    const strength = strengthLabel(score);
    if (!strength) {
      belowScore++;
      continue;
    }

    const risksText: string[] = [...crowd.flags];
    if (a.top3Concentration !== null && a.top3Concentration > 0.5)
      risksText.push(
        `资金仍集中于少数龙头（前三只占 ${(a.top3Concentration * 100).toFixed(0)}%）`,
      );
    if (cat.grade === "NONE") risksText.push("尚未找到可查证的催化，仅有资金与价格迹象");
    if (dataPenalty > 0)
      risksText.push(`仅 ${a.coverage20}/${a.members} 只成分股有足够历史，行业口径偏窄`);
    if (signalType === "EARLY") risksText.push("趋势尚未完全确认，需后续交易日继续验证");

    sectorDrafts.push({
      signalType,
      sector: a.sector,
      score,
      strength,
      reasons: hit.met,
      risks: risksText,
      metrics: m,
      catalyst: cat,
      leaders: a.leaders,
    });
  }

  // ---- 个股 ---------------------------------------------------------------
  const picked = selectOpportunities(
    sectorDrafts.map((s) => ({ key: s.sector, sector: s.sector, score: s.score })),
    [],
  );
  const inPlay = new Set(picked.sectors.map((s) => s.sector));

  let stockCandidates = 0;
  let stocksFilteredOut = 0;
  let stocksBelowScore = 0;
  let rsPassed = 0;
  const stockDrafts: StockDraft[] = [];

  // 同行业内的资金强度分位要在行业内部比（§2-3：位于同行业前 20%）
  const fundInSector = new Map<string, Map<string, number>>();
  for (const [sector, members] of bySector) {
    const raw = members.map((m) => {
      const last = m.bars[m.bars.length - 1];
      const ratio = last?.netRatio ?? 0;
      const persist = persistenceRaw(m.bars);
      return { ticker: m.ticker, v: ratio * 100 + persist / 100 };
    });
    const sample = raw.map((r) => r.v);
    fundInSector.set(
      sector,
      new Map(raw.map((r) => [r.ticker, percentileRank(sample, r.v)])),
    );
  }

  for (const s of stocks) {
    if (!s.sector) continue;
    const agg = sectorMetrics.get(s.sector);
    if (!agg) continue;
    const inSelected = inPlay.has(s.sector);
    const last = s.bars[s.bars.length - 1];
    if (!last) continue;

    const ret3 = returnOverDays(s.bars, 3);
    const ret5 = returnOverDays(s.bars, 5);
    const excess3 =
      ret3 !== null && agg.ret3 !== null ? ret3 - agg.ret3 : null;
    const fundPctInSector = fundInSector.get(s.sector)?.get(s.ticker) ?? 50;
    const cat = input.catalystsByTicker.get(s.ticker) ?? EMPTY_CATALYST;
    const consecutive =
      input.consecutiveLimitUpsByTicker?.get(s.ticker) ??
      countConsecutiveLimitUps(s);

    // 逆势走强只在**未入选行业**里找；入选行业里的股走"代表股"路径
    const rs = !inSelected
      ? relativeStrengthGate({
          ret3,
          ret5,
          sectorRet3: agg.ret3,
          mkt3: benchmark.ret3,
          fundPctInSector,
          posFlowDays3: positiveFlowDays(s.bars, 3),
          catalyst: cat.grade,
          severeCrowding: false,
          consecutiveLimitUps: consecutive,
        })
      : null;

    if (!inSelected && !rs?.pass) continue;
    stockCandidates++;

    const basics = input.stockBasics.get(s.ticker);
    if (!basics) {
      stocksFilteredOut++;
      continue;
    }
    const filtered = baseFilter(basics);
    if (!filtered.ok) {
      stocksFilteredOut++;
      continue;
    }

    const crowd = crowding({
      scope: "STOCK",
      ret5,
      ret20: returnOverDays(s.bars, 20),
      amountRatio20: amountRatioVs(s.bars, 20),
      limitUpShare: null,
      priceUpFlowOut:
        last.changePct > 0 &&
        s.bars.slice(-3).every((b) => b.netAmount !== null && b.netAmount < 0),
      topConcentration: null,
    });
    if (crowd.severe) {
      risks.push({
        kind: "STOCK",
        name: s.name,
        ticker: s.ticker,
        entityId: s.entityId,
        flags: crowd.flags,
      });
      continue;
    }

    // §5：涨停股要过额外一道门槛（催化 + 非单日脉冲 + 没连续大涨）
    const limited = limitUpGate({
      limitUpToday: isLimitUp(s.ticker, last.changePct),
      catalyst: cat.grade,
      posFlowDays3: positiveFlowDays(s.bars, 3),
      ret5,
      consecutiveLimitUps: consecutive,
    });
    if (!limited.pass) {
      stocksFilteredOut++;
      continue;
    }

    const floatCap = input.floatCapByTicker?.get(s.ticker) ?? null;
    const fundScore = fundStrengthScore({
      absPct: fundPctInSector,
      ratioPct: percentileRank(
        (bySector.get(s.sector) ?? []).map(
          (m) => m.bars[m.bars.length - 1]?.netRatio ?? 0,
        ),
        last.netRatio ?? 0,
      ),
      floatPct:
        floatCap && last.netAmount !== null
          ? percentileRank(
              (bySector.get(s.sector) ?? []).map((m) => {
                const fc = input.floatCapByTicker?.get(m.ticker);
                const na = m.bars[m.bars.length - 1]?.netAmount;
                return fc && na !== undefined && na !== null ? na / fc : 0;
              }),
              last.netAmount / floatCap,
            )
          : null,
      anomalyPct: selfPercentile(s.bars, (b) => b.netAmount, 60, 20) ?? 50,
      persistPct: clamp100(positiveFlowDays(s.bars, 5) * 20),
    });

    // 价格阶段：还没大涨给高分，涨多了给低分（"早期"是这个模块的立身之本）
    const priceStage =
      ret5 === null ? 50 : clamp100(100 - Math.max(0, ret5) * 4);
    const score = stockOpportunityScore({
      relToSector: excess3 === null ? 50 : clamp100(50 + excess3 * 8),
      fund: fundScore,
      catalyst: catalystScore(cat.grade),
      sectorSignal:
        sectorDrafts.find((d) => d.sector === s.sector)?.score ?? 50,
      priceStage,
      crowdPenalty: crowd.penalty,
      dataPenalty: s.bars.length < 40 ? 15 : 0,
    });
    const strength = strengthLabel(score);
    if (!strength) {
      stocksBelowScore++;
      continue;
    }
    if (rs?.pass) rsPassed++;

    const signalType: StockDraft["signalType"] = rs?.pass
      ? "RELATIVE_STRENGTH"
      : (sectorDrafts.find((d) => d.sector === s.sector)?.signalType ?? "EARLY");

    const reasons = rs?.pass
      ? rs.met
      : [
          excess3 !== null && excess3 > 0
            ? `近 3 日跑赢所属行业 ${excess3.toFixed(1)} 个百分点`
            : "与所属行业同步",
          `资金强度居行业内前 ${Math.max(1, Math.round(100 - fundPctInSector))}%`,
          `所属行业「${s.sector}」本身在${sectorDrafts.find((d) => d.sector === s.sector)?.signalType === "CONFIRMED" ? "趋势形成" : "刚刚启动"}`,
        ];

    const risksText = [...crowd.flags];
    if (limited.notice) risksText.push(limited.notice);
    if (cat.grade === "NONE")
      risksText.push("暂无明确催化，属于资金与价格异动，仍需验证");
    if (isLimitUp(s.ticker, last.changePct))
      risksText.push("今日已涨停，不属于早期机会");

    stockDrafts.push({
      signalType,
      ticker: s.ticker,
      entityId: s.entityId,
      name: s.name,
      sector: s.sector,
      score,
      strength,
      reasons,
      risks: risksText,
      metrics: {
        changePct: last.changePct,
        ret3,
        ret5,
        ret20: returnOverDays(s.bars, 20),
        sectorRet3: agg.ret3,
        sectorRet5: agg.ret5,
        mkt3: benchmark.ret3,
        excessOverSector3: excess3,
        netAmountToday: last.netAmount,
        netRatioToday: last.netRatio,
        netFlow3: netFlowSum(s.bars, 3),
        posFlowDays3: positiveFlowDays(s.bars, 3),
        posFlowDays5: positiveFlowDays(s.bars, 5),
        amountToday: last.amount,
        amountRatio20: amountRatioVs(s.bars, 20),
        avgAmount20: basics.avgAmount20,
        fundScore,
        fundPctInSector,
        selfAnomalyPct: selfPercentile(s.bars, (b) => b.netAmount, 60, 20),
        limitUpToday: isLimitUp(s.ticker, last.changePct),
        consecutiveLimitUps: consecutive,
      },
      catalyst: cat,
      fromUnselectedSector: !inSelected,
    });
  }

  const final = selectOpportunities(
    sectorDrafts.map((s) => ({ key: s.sector, sector: s.sector, score: s.score })),
    stockDrafts.map((s) => ({
      key: s.ticker,
      ticker: s.ticker,
      sector: s.sector,
      score: s.score,
      fromUnselectedSector: s.fromUnselectedSector,
    })),
  );
  const keptSectors = new Set(final.sectors.map((s) => s.sector));
  const keptStocks = new Set(final.stocks.map((s) => s.ticker));

  return {
    sectors: sectorDrafts
      .filter((s) => keptSectors.has(s.sector))
      .sort((a, b) => b.score - a.score),
    stocks: stockDrafts
      .filter((s) => keptStocks.has(s.ticker))
      .sort((a, b) => b.score - a.score),
    risks,
    diagnostics: {
      stocksLoaded: stocks.length,
      stocksWithSector: stocks.filter((s) => s.sector).length,
      sectorsEvaluated: aggs.length,
      sectorsPassedEarly: passedEarly,
      sectorsPassedConfirmed: passedConfirmed,
      sectorsBelowScore: belowScore,
      sectorsCrowded: crowdedCount,
      stockCandidates,
      stocksFilteredOut,
      stocksBelowScore,
      relativeStrengthPassed: rsPassed,
      benchmark,
    },
  };
}

/** 从收盘序列数连续涨停天数（K 线校验拿不到时的兜底口径）。 */
export function countConsecutiveLimitUps(s: StockSeries): number {
  let n = 0;
  for (let i = s.bars.length - 1; i >= 0; i--) {
    if (isLimitUp(s.ticker, s.bars[i]!.changePct)) n++;
    else break;
  }
  return n;
}

export { MIN_MEMBERS };
export type { CatalystGrade };
