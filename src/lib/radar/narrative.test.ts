import { describe, it, expect } from "vitest";
import { sectorNarrative, stockNarrative, yi } from "./narrative";
import type { SectorDraft, StockDraft } from "./engine";

const SECTOR: SectorDraft = {
  signalType: "EARLY",
  sector: "半导体",
  score: 71.2,
  strength: "MEDIUM",
  reasons: ["资金强度居全行业前 20%", "近 3 日有 2 天资金净流入"],
  risks: ["资金仍集中于少数龙头（前三只占 62%）"],
  catalyst: {
    grade: "MEDIUM",
    items: [
      {
        id: "n1",
        title: "存储价格环比上涨15%",
        sourceName: "集微网",
        tier: "MEDIA",
        url: "https://x/1",
        publishedAt: new Date("2026-07-30T02:00:00Z"),
        importance: 70,
        eventType: null,
        boundCount: 2,
        grade: "MEDIUM",
      },
    ],
    emptyNote: null,
  },
  leaders: [],
  metrics: {
    members: 193,
    avgChangePct: 1.2,
    up: 120,
    down: 60,
    upShare: 0.62,
    upShareAvg5: 0.44,
    limitUpShare: 0.01,
    ret3: 1.8,
    ret5: 2.4,
    ret20: 6.1,
    mkt3: 0.3,
    mkt5: 0.5,
    mkt20: 2.0,
    netAmountToday: 1.2e9,
    netRatioToday: 0.031,
    netFlow3: 4.2e9,
    netFlow5: 5.0e9,
    posFlowDays3: 2,
    posFlowDays5: 3,
    amountToday: 4e10,
    amountRatio20: 1.35,
    top2Concentration: 0.42,
    top3Concentration: 0.62,
    fundScore: 78,
    fundPct: 88,
    selfAnomalyPct: 83,
    rankUp: 12,
    coverage20: 190,
  },
};

describe("yi", () => {
  it("元 → 亿，带正负号", () => {
    expect(yi(4.2e9)).toBe("+42.0 亿");
    expect(yi(-3.5e8)).toBe("-3.5 亿");
    expect(yi(null)).toBe("—");
  });
});

describe("sectorNarrative（§8 用户页面展示的六段）", () => {
  const n = sectorNarrative(SECTOR);

  it("六段齐全，且都是人话（不出现分数、Z-score、分位数）", () => {
    for (const v of [n.whyWatch, n.fundStory, n.stage, n.catalyst, n.verify, n.risk])
      expect(v.length).toBeGreaterThan(6);
    const all = Object.values(n).join(" ");
    expect(all).not.toMatch(/71\.2|分位|Z-?score|internalScore/i);
  });

  it("资金一段说清金额、占成交额比例、是否连续", () => {
    expect(n.fundStory).toContain("42.0 亿");
    expect(n.fundStory).toContain("3.1%");
    expect(n.fundStory).toContain("2 天");
  });

  it("阶段一段说清「还没大涨 / 刚走强 / 趋势形成 / 接近过热」", () => {
    expect(n.stage).toMatch(/尚未|早期|刚|趋势|过热/);
    expect(n.stage).toContain("5 日");
  });

  it("催化一段引用最可靠的一条，并说明还需验证什么", () => {
    expect(n.catalyst).toContain("存储价格环比上涨15%");
    expect(n.verify).toMatch(/资金|扩散|上涨公司/);
  });

  it("没有催化时明说「暂无明确催化」，不编因果", () => {
    const bare = sectorNarrative({
      ...SECTOR,
      catalyst: { grade: "NONE", items: [], emptyNote: "暂无明确催化，属于资金与价格异动，仍需验证。" },
    });
    expect(bare.catalyst).toContain("暂无明确催化");
  });

  it("趋势形成的阶段描述与刚刚启动不同", () => {
    const conf = sectorNarrative({ ...SECTOR, signalType: "CONFIRMED" });
    expect(conf.stage).not.toBe(n.stage);
  });

  it("风险一段来自真实触发的风险项，不是套话", () => {
    expect(n.risk).toContain("集中");
  });
});

const STOCK: StockDraft = {
  signalType: "RELATIVE_STRENGTH",
  ticker: "603707",
  entityId: "e1",
  name: "健友股份(603707)",
  sector: "化学制药",
  score: 89.1,
  strength: "STRONG",
  reasons: ["近 3 日跑赢所属行业 8.5 个百分点"],
  risks: [],
  fromUnselectedSector: true,
  catalyst: SECTOR.catalyst,
  metrics: {
    changePct: 0.6,
    ret3: 7.2,
    ret5: 8.0,
    ret20: 3.0,
    sectorRet3: -1.3,
    sectorRet5: -2.0,
    mkt3: -1.2,
    excessOverSector3: 8.5,
    netAmountToday: 3.1e7,
    netRatioToday: 0.09,
    netFlow3: 6.2e7,
    posFlowDays3: 2,
    posFlowDays5: 3,
    amountToday: 3.4e8,
    amountRatio20: 1.4,
    avgAmount20: 2.6e8,
    fundScore: 80,
    fundPctInSector: 96,
    selfAnomalyPct: 90,
    limitUpToday: false,
    consecutiveLimitUps: 0,
  },
};

describe("stockNarrative", () => {
  const n = stockNarrative(STOCK);

  it("逆势走强要说清「行业弱、这家强」", () => {
    expect(n.whyWatch).toContain("化学制药");
    expect(n.whyWatch).toMatch(/跑赢|逆势|弱/);
  });

  it("涨停股必须带「已经涨停，不属于早期机会」的提醒（§5）", () => {
    const lim = stockNarrative({
      ...STOCK,
      metrics: { ...STOCK.metrics, limitUpToday: true, changePct: 10 },
    });
    expect(lim.risk).toContain("已经涨停");
  });

  it("没有催化时不给因果解释", () => {
    const bare = stockNarrative({
      ...STOCK,
      catalyst: { grade: "NONE", items: [], emptyNote: "暂无明确催化，属于资金与价格异动，仍需验证。" },
    });
    expect(bare.catalyst).toContain("暂无明确催化");
  });
});

describe("stockNarrative — 「跑赢 X 个百分点」不能被读成「涨了 X%」", () => {
  it("同时给出个股与行业两个绝对数，不让差值单独出现", () => {
    const n = stockNarrative(STOCK);
    expect(n.whyWatch).toContain("7.2%"); // 个股自己近 3 日
    expect(n.whyWatch).toContain("-1.3%"); // 行业近 3 日
    expect(n.whyWatch).toContain("百分点");
  });
});
