/**
 * 三种信号的入选闸门（需求 §2）——纯函数、无 IO、可测。
 *
 * 这一层是「机会雷达」和「市场强弱地图」的分界线：**地图只回答哪些行业强/弱，
 * 闸门回答哪些变化可能仍处于早期、值得研究**。跌得多、涨得多都不自动等于机会。
 *
 * 两条贯穿整层的规矩：
 *  · **缺数据 = 该条不满足**（不是"当成满足"也不是"跳过不计"）。宁缺毋滥，
 *    并把缺了哪项报进 `missing`，让"今天没信号"能区分成"确实没有"和"数据没到"。
 *  · **主力资金不能单独定生死**（§3）——每条闸门里资金都只是合取式的一项，
 *    另有价格、广度或催化来确认。
 */

import type { CatalystGrade } from "./score";

export type GateResult = {
  pass: boolean;
  /** 命中的条件（人话），直接进 `OpportunitySignal.reasons` */
  met: string[];
  /** 因为缺数据判不了的条件 */
  missing: string[];
};

export type SectorGateInput = {
  /** 资金强度在全部行业中的分位 0..100 */
  fundPct: number;
  /** 资金强度相对自身近 60 日的分位 0..100，历史不足为 null */
  selfAnomalyPct: number | null;
  posFlowDays3: number;
  posFlowDays5: number;
  /** 今日上涨股占比 0..1 */
  upShare: number;
  /** 过去 5 日上涨股占比均值 0..1 */
  upShareAvg5: number | null;
  ret3: number | null;
  ret5: number | null;
  ret20: number | null;
  /** 全 A 同期收益 */
  mkt3: number | null;
  mkt5: number | null;
  /** 行业强弱排名较 3 日前上升的名次（正=上升） */
  rankUp: number | null;
  amountRatio20: number | null;
  top3Concentration: number | null;
  top2Concentration: number | null;
  severeCrowding: boolean;
};

/** 「刚刚启动」五条里至少要中几条（需求原文：至少满足 4 项）。 */
export const EARLY_MIN_CONDITIONS = 4;
/** 资金强度进入前 20% 的分位门槛。 */
export const TOP_QUINTILE = 80;
/** 广度较 5 日均值的提升门槛（百分点 → 小数）。 */
export const BREADTH_JUMP = 0.15;
/** 「强弱排名明显上升」的名次门槛。 */
export const RANK_UP_MIN = 20;

/**
 * §2-1 刚刚启动：资金明显流入、板块表现开始改善，但价格尚未大幅上涨。
 *
 * 注意第⑤条（5日<12%、20日<25%）与 §7 的行业拥挤阈值是**同一组数**：
 * 涨过头了既会让第⑤条落空、也会触发拥挤规则。这不是重复，是同一条产品判断
 * 在"还早不早"和"追不追高"两个问句下的两次出现。
 */
export function earlyGate(i: SectorGateInput): GateResult {
  const met: string[] = [];
  const missing: string[] = [];

  // ① 资金强度前 20%，或达到自身近 60 日较少见的水平
  if (i.fundPct >= TOP_QUINTILE)
    met.push(`资金强度居全行业前 ${100 - TOP_QUINTILE}%`);
  else if (i.selfAnomalyPct !== null && i.selfAnomalyPct >= TOP_QUINTILE)
    met.push("资金流入达到自身近 60 日少见的水平");

  // ② 最近 3 个交易日至少 2 天资金净流入
  if (i.posFlowDays3 >= 2) met.push(`近 3 日有 ${i.posFlowDays3} 天资金净流入`);

  // ③ 上涨股占比较过去 5 日均值提高 ≥15 个百分点
  if (i.upShareAvg5 === null) missing.push("upShareAvg5");
  else if (i.upShare - i.upShareAvg5 >= BREADTH_JUMP)
    met.push(
      `上涨公司占比 ${(i.upShare * 100).toFixed(0)}%，比近 5 日均值高 ${((i.upShare - i.upShareAvg5) * 100).toFixed(0)} 个百分点`,
    );

  // ④ 3 日跑赢全 A，或强弱排名明显上升
  if (i.ret3 === null || i.mkt3 === null) missing.push("ret3/mkt3");
  else if (i.ret3 > i.mkt3)
    met.push(`近 3 日跑赢全 A ${(i.ret3 - i.mkt3).toFixed(1)} 个百分点`);
  else if (i.rankUp !== null && i.rankUp >= RANK_UP_MIN)
    met.push(`行业强弱排名 3 日内上升 ${i.rankUp} 位`);

  // ⑤ 尚未大涨
  if (i.ret5 === null || i.ret20 === null) missing.push("ret5/ret20");
  else if (i.ret5 < 12 && i.ret20 < 25)
    met.push(
      `尚未明显上涨（5 日 ${i.ret5.toFixed(1)}%、20 日 ${i.ret20.toFixed(1)}%）`,
    );

  return {
    pass: met.length >= EARLY_MIN_CONDITIONS && !i.severeCrowding,
    met,
    missing,
  };
}

/**
 * §2-2 趋势形成：资金连续流入、多数股票同步上涨，趋势已被市场确认。
 * **合取式**——任一条不满足即不通过，不是"满足几条"。
 */
export function confirmedGate(i: SectorGateInput): GateResult {
  const met: string[] = [];
  const missing: string[] = [];
  let pass = true;

  const need = (
    ok: boolean | null,
    reason: string,
    missingKey?: string,
  ): void => {
    if (ok === null) {
      pass = false;
      if (missingKey) missing.push(missingKey);
      return;
    }
    if (ok) met.push(reason);
    else pass = false;
  };

  need(
    i.ret5 === null || i.mkt5 === null ? null : i.ret5 > i.mkt5,
    i.ret5 !== null && i.mkt5 !== null
      ? `近 5 日跑赢全 A ${(i.ret5 - i.mkt5).toFixed(1)} 个百分点`
      : "",
    "ret5/mkt5",
  );
  need(i.upShare >= 0.6, `${(i.upShare * 100).toFixed(0)}% 的成分股在涨`);
  need(i.posFlowDays5 >= 3, `近 5 日有 ${i.posFlowDays5} 天资金净流入`);
  need(
    i.amountRatio20 === null
      ? null
      : i.amountRatio20 >= 1.2 && i.amountRatio20 <= 2.5,
    i.amountRatio20 !== null
      ? `成交额是 20 日均量的 ${i.amountRatio20.toFixed(1)} 倍（放量但未爆量）`
      : "",
    "amountRatio20",
  );
  // 「不是只由一两只大市值股票贡献」——需求只给了前三 60% 这个数字，
  // 前两只 50% 是把"一两只"这句话量化，写死在这里可测。
  need(
    i.top3Concentration === null ? null : i.top3Concentration <= 0.6,
    i.top3Concentration !== null
      ? `资金不集中于头部（前三只占 ${(i.top3Concentration * 100).toFixed(0)}%）`
      : "",
    "top3Concentration",
  );
  need(
    i.top2Concentration === null ? null : i.top2Concentration <= 0.5,
    "",
    "top2Concentration",
  );
  if (i.severeCrowding) pass = false;

  return { pass, met: met.filter(Boolean), missing };
}

export type StockGateInput = {
  ret3: number | null;
  ret5: number | null;
  /** 所属行业同期收益 */
  sectorRet3: number | null;
  mkt3: number | null;
  /** 个股资金强度在**同行业内**的分位 */
  fundPctInSector: number;
  posFlowDays3: number;
  catalyst: CatalystGrade;
  severeCrowding: boolean;
  /** 连续涨停天数 */
  consecutiveLimitUps: number;
};

/** 跑赢所属行业的最低幅度（百分点）。 */
export const RS_EXCESS_MIN = 3;

/**
 * §2-3 逆势走强：行业整体较弱，但这家公司因为独立催化明显跑赢行业。
 *
 * 「行业整体表现较弱」这一条需求正文没写进条件列表、只写在用户解释里——
 * 但没有它，标签就在说谎（行业很强时个股跑赢行业不叫"逆势"）。这里把它补成硬条件，
 * 判据是**行业 3 日不强于全 A**。
 */
export function relativeStrengthGate(i: StockGateInput): GateResult {
  const met: string[] = [];
  const missing: string[] = [];
  let pass = true;

  if (i.ret3 === null || i.sectorRet3 === null) {
    pass = false;
    missing.push("ret3/sectorRet3");
  } else if (i.ret3 - i.sectorRet3 >= RS_EXCESS_MIN)
    met.push(
      `近 3 日跑赢所属行业 ${(i.ret3 - i.sectorRet3).toFixed(1)} 个百分点`,
    );
  else pass = false;

  if (i.sectorRet3 === null || i.mkt3 === null) {
    pass = false;
    missing.push("sectorRet3/mkt3");
  } else if (i.sectorRet3 <= i.mkt3)
    met.push("所属行业整体并不强，涨幅来自公司自身");
  else pass = false;

  if (i.fundPctInSector >= TOP_QUINTILE)
    met.push(`资金强度居同行业前 ${100 - TOP_QUINTILE}%`);
  else pass = false;

  if (i.posFlowDays3 >= 2) met.push(`近 3 日有 ${i.posFlowDays3} 天资金净流入`);
  else pass = false;

  // 只有涨幅、没有资金和催化，不得进入（需求原文）
  if (i.catalyst === "HIGH" || i.catalyst === "MEDIUM")
    met.push(i.catalyst === "HIGH" ? "有一手催化可查证" : "有可查证的催化");
  else pass = false;

  if (i.consecutiveLimitUps >= 2) pass = false;
  if (i.ret5 !== null && i.ret5 > 20) pass = false;
  if (i.severeCrowding) pass = false;

  return { pass, met, missing };
}

export type LimitUpInput = {
  limitUpToday: boolean;
  catalyst: CatalystGrade;
  posFlowDays3: number;
  ret5: number | null;
  consecutiveLimitUps: number;
};

/**
 * §5 当日涨停股的额外门槛。
 *
 * 需求原文：「不得仅因为股票涨停而入选。当日涨停股票只有在同时满足以下条件时才允许展示：
 * 有明确且可验证的催化；资金不是单日脉冲；过去5日没有连续大涨；所属行业或公司基本面
 * 逻辑能够支持；卡片明确提醒『已经涨停，不属于早期机会』。」
 *
 * 「所属行业或公司基本面逻辑能够支持」由上游保证——个股要么来自已入选行业
 * （行业逻辑），要么走逆势走强（必须有催化）。这里管的是另外三条 + 那句提醒。
 */
export function limitUpGate(i: LimitUpInput): {
  pass: boolean;
  notice: string | null;
  reason?: string;
} {
  if (!i.limitUpToday) return { pass: true, notice: null };
  const notice = "已经涨停，不属于早期机会";
  if (i.catalyst !== "HIGH" && i.catalyst !== "MEDIUM")
    return { pass: false, notice, reason: "涨停但没有可验证的催化" };
  if (i.posFlowDays3 < 2)
    return { pass: false, notice, reason: "涨停且资金只是单日脉冲" };
  if (i.consecutiveLimitUps >= 2)
    return { pass: false, notice, reason: "已经连续涨停" };
  if (i.ret5 !== null && i.ret5 > 20)
    return { pass: false, notice, reason: "过去 5 日已经连续大涨" };
  return { pass: true, notice };
}
