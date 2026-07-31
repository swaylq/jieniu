import { describe, it, expect } from "vitest";
import {
  fundStrengthScore,
  catalystScore,
  crowding,
  sectorOpportunityScore,
  stockOpportunityScore,
  strengthLabel,
  DISPLAY_MIN,
  STRONG_MIN,
} from "./score";

describe("fundStrengthScore（§3 资金强度）", () => {
  const base = {
    absPct: 50,
    ratioPct: 50,
    floatPct: null,
    anomalyPct: 50,
    persistPct: 50,
  };

  it("全部中位数 → 50 分", () => {
    expect(fundStrengthScore(base)).toBeCloseTo(50, 6);
  });

  it("权重是 25/35/25/15（净流入占成交额权重最高——它才是不受体量影响的那个）", () => {
    expect(fundStrengthScore({ ...base, absPct: 100 })).toBeCloseTo(
      50 + 0.25 * 50,
      6,
    );
    expect(fundStrengthScore({ ...base, ratioPct: 100 })).toBeCloseTo(
      50 + 0.35 * 50,
      6,
    );
    expect(fundStrengthScore({ ...base, anomalyPct: 100 })).toBeCloseTo(
      50 + 0.25 * 50,
      6,
    );
    expect(fundStrengthScore({ ...base, persistPct: 100 })).toBeCloseTo(
      50 + 0.15 * 50,
      6,
    );
  });

  it("有流通市值时从前两项各挪 5%，给「净流入/流通市值」10%", () => {
    // 只有 floatPct 拉满：应恰好加 10% × 50
    expect(fundStrengthScore({ ...base, floatPct: 100 })).toBeCloseTo(
      50 + 0.1 * 50,
      6,
    );
    // absPct 拉满时贡献从 25% 降到 20%
    expect(
      fundStrengthScore({ ...base, floatPct: 50, absPct: 100 }),
    ).toBeCloseTo(50 + 0.2 * 50, 6);
  });

  it("权重恒和为 1（有没有流通市值都一样）", () => {
    const allTop = { absPct: 100, ratioPct: 100, anomalyPct: 100, persistPct: 100 };
    expect(fundStrengthScore({ ...allTop, floatPct: null })).toBeCloseTo(100, 6);
    expect(fundStrengthScore({ ...allTop, floatPct: 100 })).toBeCloseTo(100, 6);
  });
});

describe("catalystScore（§6 催化质量）", () => {
  it("高/中/低/无 → 100/65/30/0", () => {
    expect(catalystScore("HIGH")).toBe(100);
    expect(catalystScore("MEDIUM")).toBe(65);
    expect(catalystScore("LOW")).toBe(30);
    expect(catalystScore("NONE")).toBe(0);
  });
});

describe("crowding（§7 过热与追高）", () => {
  const none = {
    scope: "SECTOR" as const,
    ret5: 3,
    ret20: 8,
    amountRatio20: 1.3,
    limitUpShare: 0.02,
    priceUpFlowOut: false,
    topConcentration: 0.4,
  };

  it("都不触发 → 罚 0、不 severe", () => {
    const c = crowding(none);
    expect(c.penalty).toBe(0);
    expect(c.severe).toBe(false);
    expect(c.flags).toEqual([]);
  });

  it("行业 5 日 >12% / 20 日 >25% 触发", () => {
    expect(crowding({ ...none, ret5: 12.5 }).flags.length).toBe(1);
    expect(crowding({ ...none, ret20: 26 }).flags.length).toBe(1);
  });

  it("个股用更宽的阈值（5日>20%、20日>35%）——个股波动天然大于行业", () => {
    const stock = { ...none, scope: "STOCK" as const, ret5: 15, ret20: 30 };
    expect(crowding(stock).flags).toEqual([]);
    expect(crowding({ ...stock, ret5: 21 }).flags.length).toBe(1);
    expect(crowding({ ...stock, ret20: 36 }).flags.length).toBe(1);
  });

  it("成交额 >2.5 倍、涨停占比过高、涨价却资金流出、极少数股贡献 都各记一条", () => {
    expect(crowding({ ...none, amountRatio20: 2.6 }).flags.length).toBe(1);
    expect(crowding({ ...none, limitUpShare: 0.16 }).flags.length).toBe(1);
    expect(crowding({ ...none, priceUpFlowOut: true }).flags.length).toBe(1);
    expect(crowding({ ...none, topConcentration: 0.75 }).flags.length).toBe(1);
  });

  it("触发两条及以上 = 严重拥挤 → 不进机会列表，转「追高风险」", () => {
    const c = crowding({ ...none, ret5: 13, amountRatio20: 3 });
    expect(c.severe).toBe(true);
    expect(c.penalty).toBeGreaterThan(0);
  });

  it("缺数据不算触发——「没量到」不能当成「没过热」的反面，也不能当成过热", () => {
    const c = crowding({
      scope: "SECTOR",
      ret5: null,
      ret20: null,
      amountRatio20: null,
      limitUpShare: null,
      priceUpFlowOut: false,
      topConcentration: null,
    });
    expect(c.flags).toEqual([]);
  });
});

describe("sectorOpportunityScore（§4 行业机会分）", () => {
  const mid = {
    fund: 50,
    relStrength: 50,
    breadth: 50,
    persistence: 50,
    catalyst: 50,
    crowdPenalty: 0,
    dataPenalty: 0,
  };

  it("权重 30/25/20/15/10", () => {
    expect(sectorOpportunityScore(mid)).toBeCloseTo(50, 6);
    expect(sectorOpportunityScore({ ...mid, fund: 100 })).toBeCloseTo(65, 6);
    expect(sectorOpportunityScore({ ...mid, relStrength: 100 })).toBeCloseTo(62.5, 6);
    expect(sectorOpportunityScore({ ...mid, breadth: 100 })).toBeCloseTo(60, 6);
    expect(sectorOpportunityScore({ ...mid, persistence: 100 })).toBeCloseTo(57.5, 6);
    expect(sectorOpportunityScore({ ...mid, catalyst: 100 })).toBeCloseTo(55, 6);
  });

  it("拥挤惩罚与数据异常惩罚直接扣分，且不会扣成负数", () => {
    expect(sectorOpportunityScore({ ...mid, crowdPenalty: 20 })).toBeCloseTo(30, 6);
    expect(sectorOpportunityScore({ ...mid, dataPenalty: 999 })).toBe(0);
  });
});

describe("stockOpportunityScore（§5 个股机会分）", () => {
  const mid = {
    relToSector: 50,
    fund: 50,
    catalyst: 50,
    sectorSignal: 50,
    priceStage: 50,
    crowdPenalty: 0,
    dataPenalty: 0,
  };

  it("权重 30/30/20/10/10", () => {
    expect(stockOpportunityScore(mid)).toBeCloseTo(50, 6);
    expect(stockOpportunityScore({ ...mid, relToSector: 100 })).toBeCloseTo(65, 6);
    expect(stockOpportunityScore({ ...mid, fund: 100 })).toBeCloseTo(65, 6);
    expect(stockOpportunityScore({ ...mid, catalyst: 100 })).toBeCloseTo(60, 6);
    expect(stockOpportunityScore({ ...mid, sectorSignal: 100 })).toBeCloseTo(55, 6);
    expect(stockOpportunityScore({ ...mid, priceStage: 100 })).toBeCloseTo(55, 6);
  });
});

describe("strengthLabel（§4 展示标准：前台不显示 76.3 这种假精确）", () => {
  it("75 以上=强、65~74=中、65 以下=不展示", () => {
    expect(strengthLabel(80)).toBe("STRONG");
    expect(strengthLabel(75)).toBe("STRONG");
    expect(strengthLabel(74.9)).toBe("MEDIUM");
    expect(strengthLabel(65)).toBe("MEDIUM");
    expect(strengthLabel(64.9)).toBeNull();
  });

  it("门槛常量对外可见，测试与前台用同一份", () => {
    expect(DISPLAY_MIN).toBe(65);
    expect(STRONG_MIN).toBe(75);
  });
});
