import { describe, it, expect } from "vitest";
import {
  earlyGate,
  confirmedGate,
  relativeStrengthGate,
  limitUpGate,
  EARLY_MIN_CONDITIONS,
  type SectorGateInput,
  type StockGateInput,
} from "./gates";

/** 一个「刚刚启动」五条全满足的行业。各用例只改一个字段，看它是否翻转。 */
const EARLY_OK: SectorGateInput = {
  fundPct: 85,
  selfAnomalyPct: 60,
  posFlowDays3: 2,
  upShare: 0.55,
  upShareAvg5: 0.35,
  ret3: 1.5,
  mkt3: 0.2,
  rankUp: 0,
  ret5: 4,
  ret20: 10,
  mkt5: 1,
  posFlowDays5: 3,
  amountRatio20: 1.4,
  top3Concentration: 0.45,
  top2Concentration: 0.3,
  severeCrowding: false,
};

describe("earlyGate（§2-1 刚刚启动）", () => {
  it("五条全中且不拥挤 → 通过，命中条目全部报出来", () => {
    const r = earlyGate(EARLY_OK);
    expect(r.pass).toBe(true);
    expect(r.met).toHaveLength(5);
  });

  it("资金强度不在前 20%，但自身 60 日罕见 → 第①条仍算满足", () => {
    const r = earlyGate({ ...EARLY_OK, fundPct: 40, selfAnomalyPct: 85 });
    expect(r.met).toHaveLength(5);
    expect(r.pass).toBe(true);
  });

  it("四条即可通过（需求写的是「至少满足4项」）", () => {
    const r = earlyGate({ ...EARLY_OK, posFlowDays3: 1 });
    expect(r.met).toHaveLength(4);
    expect(r.pass).toBe(true);
    expect(EARLY_MIN_CONDITIONS).toBe(4);
  });

  it("只满足三条 → 不通过", () => {
    const r = earlyGate({ ...EARLY_OK, posFlowDays3: 1, upShareAvg5: 0.5 });
    expect(r.met.length).toBeLessThan(4);
    expect(r.pass).toBe(false);
  });

  it("广度提升必须 ≥15 个百分点", () => {
    expect(earlyGate({ ...EARLY_OK, upShare: 0.49, upShareAvg5: 0.35 }).met).toHaveLength(4);
    expect(earlyGate({ ...EARLY_OK, upShare: 0.5, upShareAvg5: 0.35 }).met).toHaveLength(5);
  });

  it("已经大涨（5日≥12%）不叫「刚刚启动」——第⑤条落空", () => {
    const r = earlyGate({ ...EARLY_OK, ret5: 13 });
    expect(r.met).toHaveLength(4);
  });

  it("严重拥挤一票否决，哪怕五条全中", () => {
    expect(earlyGate({ ...EARLY_OK, severeCrowding: true }).pass).toBe(false);
  });

  it("跑输全A但强弱排名明显上升 → 第④条仍算满足", () => {
    const r = earlyGate({ ...EARLY_OK, ret3: -0.5, mkt3: 0.2, rankUp: 25 });
    expect(r.met).toHaveLength(5);
  });

  it("缺数据的那条算「不满足」，不算「满足」——宁缺毋滥", () => {
    const r = earlyGate({ ...EARLY_OK, ret5: null, ret20: null });
    expect(r.met).toHaveLength(4);
    expect(r.missing).toContain("ret5/ret20");
  });
});

const CONFIRMED_OK: SectorGateInput = {
  ...EARLY_OK,
  ret5: 6,
  mkt5: 2,
  upShare: 0.68,
  posFlowDays5: 3,
  amountRatio20: 1.6,
  top3Concentration: 0.5,
  top2Concentration: 0.4,
};

describe("confirmedGate（§2-2 趋势形成）", () => {
  it("全部条件满足 → 通过", () => {
    expect(confirmedGate(CONFIRMED_OK).pass).toBe(true);
  });

  it("是合取式——任一条不满足即不通过（不是「满足几条」）", () => {
    expect(confirmedGate({ ...CONFIRMED_OK, upShare: 0.59 }).pass).toBe(false);
    expect(confirmedGate({ ...CONFIRMED_OK, ret5: 1, mkt5: 2 }).pass).toBe(false);
    expect(confirmedGate({ ...CONFIRMED_OK, posFlowDays5: 2 }).pass).toBe(false);
    expect(confirmedGate({ ...CONFIRMED_OK, severeCrowding: true }).pass).toBe(false);
  });

  it("成交额要在 20 日均量的 1.2~2.5 倍之间：缩量不算、爆量也不算", () => {
    expect(confirmedGate({ ...CONFIRMED_OK, amountRatio20: 1.1 }).pass).toBe(false);
    expect(confirmedGate({ ...CONFIRMED_OK, amountRatio20: 2.6 }).pass).toBe(false);
    expect(confirmedGate({ ...CONFIRMED_OK, amountRatio20: 1.2 }).pass).toBe(true);
  });

  it("前三只贡献 >60% 或前两只 >50% → 资金太集中，不算趋势", () => {
    expect(confirmedGate({ ...CONFIRMED_OK, top3Concentration: 0.61 }).pass).toBe(false);
    expect(confirmedGate({ ...CONFIRMED_OK, top2Concentration: 0.51 }).pass).toBe(false);
  });

  it("缺任一必需数据 → 不通过并报出缺哪项", () => {
    const r = confirmedGate({ ...CONFIRMED_OK, amountRatio20: null });
    expect(r.pass).toBe(false);
    expect(r.missing).toContain("amountRatio20");
  });
});

const RS_OK: StockGateInput = {
  ret3: 6,
  sectorRet3: 1,
  mkt3: 1.2,
  fundPctInSector: 88,
  posFlowDays3: 2,
  catalyst: "HIGH",
  severeCrowding: false,
  consecutiveLimitUps: 0,
  ret5: 9,
};

describe("relativeStrengthGate（§2-3 逆势走强）", () => {
  it("全部条件满足 → 通过", () => {
    expect(relativeStrengthGate(RS_OK).pass).toBe(true);
  });

  it("必须至少跑赢行业 3 个百分点", () => {
    expect(relativeStrengthGate({ ...RS_OK, ret3: 3.9 }).pass).toBe(false);
    expect(relativeStrengthGate({ ...RS_OK, ret3: 4.0 }).pass).toBe(true);
  });

  it("只有涨幅、没有资金 → 不得进入（需求原文）", () => {
    expect(relativeStrengthGate({ ...RS_OK, fundPctInSector: 50 }).pass).toBe(false);
    expect(relativeStrengthGate({ ...RS_OK, posFlowDays3: 1 }).pass).toBe(false);
  });

  it("只有涨幅、没有催化 → 不得进入（需求原文）", () => {
    expect(relativeStrengthGate({ ...RS_OK, catalyst: "NONE" }).pass).toBe(false);
    expect(relativeStrengthGate({ ...RS_OK, catalyst: "LOW" }).pass).toBe(false);
    expect(relativeStrengthGate({ ...RS_OK, catalyst: "MEDIUM" }).pass).toBe(true);
  });

  it("连续涨停 / 连续大涨的股不算「逆势走强」，算过热", () => {
    expect(relativeStrengthGate({ ...RS_OK, consecutiveLimitUps: 2 }).pass).toBe(false);
    expect(relativeStrengthGate({ ...RS_OK, ret5: 25 }).pass).toBe(false);
  });

  it("行业本身很强时不叫「逆势」——标签得对得上事实", () => {
    expect(relativeStrengthGate({ ...RS_OK, sectorRet3: 3, mkt3: 1 }).pass).toBe(false);
  });
});

describe("limitUpGate（§5 当日涨停股的额外门槛）", () => {
  const ok = {
    limitUpToday: true,
    catalyst: "HIGH" as const,
    posFlowDays3: 2,
    ret5: 12,
    consecutiveLimitUps: 1,
  };

  it("涨停股同时满足四条才允许展示", () => {
    expect(limitUpGate(ok).pass).toBe(true);
  });

  it("没涨停的股不受这道门槛约束", () => {
    expect(limitUpGate({ ...ok, limitUpToday: false, catalyst: "NONE" }).pass).toBe(true);
  });

  it("没有明确催化 → 不展示", () => {
    expect(limitUpGate({ ...ok, catalyst: "NONE" }).pass).toBe(false);
    expect(limitUpGate({ ...ok, catalyst: "LOW" }).pass).toBe(false);
  });

  it("资金只是单日脉冲（近 3 日只有 1 天净流入）→ 不展示", () => {
    expect(limitUpGate({ ...ok, posFlowDays3: 1 }).pass).toBe(false);
  });

  it("过去 5 日已经连续大涨 → 不展示", () => {
    expect(limitUpGate({ ...ok, ret5: 21 }).pass).toBe(false);
    expect(limitUpGate({ ...ok, consecutiveLimitUps: 2 }).pass).toBe(false);
  });

  it("允许展示时必须带上「已经涨停，不属于早期机会」的提醒", () => {
    expect(limitUpGate(ok).notice).toContain("已经涨停");
    expect(limitUpGate({ ...ok, limitUpToday: false }).notice).toBeNull();
  });
});
