import { describe, it, expect } from "vitest";
import { runRadar, type EngineInput } from "./engine";
import type { StockSeries } from "./aggregate";
import type { StockBasics } from "./select";
import type { CatalystPick } from "./catalyst";

const DAYS = 25;

function mk(
  ticker: string,
  sector: string,
  chg: number[],
  nets: number[],
  amounts: number[],
): StockSeries {
  let close = 10;
  return {
    ticker,
    entityId: `e-${ticker}`,
    name: `股${ticker}`,
    sector,
    bars: chg.map((c, i) => {
      close = close * (1 + c / 100);
      return {
        day: `2026-06-${String(i + 1).padStart(2, "0")}`,
        close: Math.round(close * 1e6) / 1e6,
        changePct: c,
        amount: amounts[i]!,
        netAmount: nets[i]!,
        netRatio: nets[i]! / amounts[i]!,
        turnoverRate: 2,
      };
    }),
  };
}

const flatChg = Array.from({ length: DAYS }, () => 0);
const flatAmt = Array.from({ length: DAYS }, () => 1e8);

/** 一个"什么都没发生"的板块：不涨不跌、资金小幅流出。 */
function boringSector(name: string, seed: number): StockSeries[] {
  return Array.from({ length: 8 }, (_, i) =>
    mk(
      `${seed}0000${i}`,
      name,
      flatChg,
      Array.from({ length: DAYS }, () => -1e6),
      flatAmt,
    ),
  );
}

/**
 * 「刚刚启动」的形状：22 天纹丝不动，最后 3 天资金开始进、广度跳升、价格只微涨。
 */
function earlySector(name: string): StockSeries[] {
  return Array.from({ length: 10 }, (_, i) => {
    const chg = [...flatChg.slice(0, DAYS - 3), 0.4, 0.5, i < 8 ? 0.9 : -0.3];
    const nets = [
      ...Array.from({ length: DAYS - 3 }, () => -2e6),
      6e6,
      -1e6,
      9e6,
    ];
    return mk(`60${String(i).padStart(4, "0")}`, name, chg, nets, flatAmt);
  });
}

/** 「趋势形成」的形状：5 日持续跑赢、八成在涨、资金 5 天里 4 天进、温和放量。 */
function trendSector(name: string): StockSeries[] {
  return Array.from({ length: 10 }, (_, i) => {
    const chg = [...flatChg.slice(0, DAYS - 5), 0.8, 0.7, 0.6, 0.9, i < 8 ? 0.8 : -0.2];
    const nets = [
      ...Array.from({ length: DAYS - 5 }, () => -2e6),
      8e6,
      7e6,
      -1e6,
      9e6,
      8e6,
    ];
    const amts = [...flatAmt.slice(0, DAYS - 1), 1.5e8];
    return mk(`30${String(i).padStart(4, "0")}`, name, chg, nets, amts);
  });
}

function basics(stocks: StockSeries[]): Map<string, StockBasics> {
  return new Map(
    stocks.map((s) => [
      s.ticker,
      {
        name: s.name,
        barCount: s.bars.length,
        avgAmount20: 2e8,
        suspended: false,
        oneWordLimitUp: false,
        priceGapAnomaly: false,
      },
    ]),
  );
}

const HIGH_CAT: CatalystPick = {
  grade: "HIGH",
  items: [
    {
      id: "n1",
      title: "关于签订12亿元供货合同的公告",
      sourceName: "东方财富·公告",
      tier: "PRIMARY",
      url: "https://x/1",
      publishedAt: new Date("2026-06-25T02:00:00Z"),
      importance: 70,
      eventType: null,
      boundCount: 2,
      grade: "HIGH",
    },
  ],
  emptyNote: null,
};

function input(stocks: StockSeries[], over: Partial<EngineInput> = {}): EngineInput {
  return {
    stocks,
    stockBasics: basics(stocks),
    catalystsBySector: new Map(),
    catalystsByTicker: new Map(),
    floatCapByTicker: new Map(),
    ...over,
  };
}

describe("runRadar — 什么都没发生的市场", () => {
  it("全市场平淡 → 一条机会都不给（不为填满页面降标准）", () => {
    const stocks = [
      ...boringSector("A", 1),
      ...boringSector("B", 2),
      ...boringSector("C", 3),
      ...boringSector("D", 4),
      ...boringSector("E", 5),
    ];
    const r = runRadar(input(stocks));
    expect(r.sectors).toEqual([]);
    expect(r.stocks).toEqual([]);
    expect(r.diagnostics.sectorsEvaluated).toBe(5);
  });
});

describe("runRadar — 有一个板块刚刚启动", () => {
  const stocks = [
    ...earlySector("半导体"),
    ...boringSector("A", 1),
    ...boringSector("B", 2),
    ...boringSector("C", 3),
    ...boringSector("D", 4),
  ];

  it("识别出 EARLY 信号，且只给这一个板块", () => {
    const r = runRadar(input(stocks));
    const early = r.sectors.filter((s) => s.signalType === "EARLY");
    expect(early.map((s) => s.sector)).toEqual(["半导体"]);
  });

  it("信号带得出入选理由和原始指标——结论要能回到底层数据", () => {
    const r = runRadar(input(stocks));
    const s = r.sectors[0]!;
    expect(s.reasons.length).toBeGreaterThan(0);
    expect(s.metrics.ret5).not.toBeNull();
    expect(s.metrics.posFlowDays3).toBeGreaterThanOrEqual(2);
    expect(s.strength === "STRONG" || s.strength === "MEDIUM").toBe(true);
  });

  it("没有催化时不编——催化等级是 NONE 并写明仍需验证", () => {
    const r = runRadar(input(stocks));
    expect(r.sectors[0]!.catalyst.grade).toBe("NONE");
    expect(r.sectors[0]!.catalyst.emptyNote).toContain("暂无明确催化");
  });

  it("有一手催化时分数更高（催化质量占 10%）", () => {
    const withCat = runRadar(
      input(stocks, { catalystsBySector: new Map([["半导体", HIGH_CAT]]) }),
    );
    const without = runRadar(input(stocks));
    expect(withCat.sectors[0]!.score).toBeGreaterThan(without.sectors[0]!.score);
  });
});

describe("runRadar — 有一个板块趋势已经形成", () => {
  const stocks = [
    ...trendSector("光模块"),
    ...boringSector("A", 1),
    ...boringSector("B", 2),
    ...boringSector("C", 3),
    ...boringSector("D", 4),
  ];

  it("识别成 CONFIRMED 而不是 EARLY", () => {
    const r = runRadar(input(stocks));
    const hit = r.sectors.find((s) => s.sector === "光模块");
    expect(hit?.signalType).toBe("CONFIRMED");
  });

  it("代表个股只从入选板块里挑，且最多 2 只", () => {
    const r = runRadar(
      input(stocks, { catalystsByTicker: new Map([["300000", HIGH_CAT]]) }),
    );
    expect(r.stocks.length).toBeLessThanOrEqual(2);
    for (const s of r.stocks) expect(s.sector).toBe("光模块");
  });
});

describe("runRadar — 上限与去重", () => {
  it("行业不超过 3 个、总数不超过 8 个", () => {
    const stocks = [
      ...earlySector("半导体"),
      ...trendSector("光模块"),
      ...earlySector("锂电").map((s) => ({ ...s, sector: "锂电" })),
      ...trendSector("军工").map((s) => ({ ...s, sector: "军工" })),
      ...boringSector("A", 7),
      ...boringSector("B", 8),
    ];
    const r = runRadar(input(stocks));
    expect(r.sectors.length).toBeLessThanOrEqual(3);
    expect(r.sectors.length + r.stocks.length).toBeLessThanOrEqual(8);
  });

  it("基础过滤挡掉的个股不会出现在结果里（ST / 停牌 / 一字板 / 太小）", () => {
    const stocks = [...trendSector("光模块"), ...boringSector("A", 1), ...boringSector("B", 2), ...boringSector("C", 3), ...boringSector("D", 4)];
    const b = basics(stocks);
    for (const [k, v] of b) b.set(k, { ...v, suspended: true });
    const r = runRadar(
      input(stocks, {
        stockBasics: b,
        catalystsByTicker: new Map(stocks.map((s) => [s.ticker, HIGH_CAT])),
      }),
    );
    expect(r.stocks).toEqual([]);
    expect(r.diagnostics.stocksFilteredOut).toBeGreaterThan(0);
  });
});

describe("runRadar — 过热的板块不进机会列表", () => {
  it("已经连续大涨 + 爆量 → 转入追高风险，而不是「趋势形成」", () => {
    const hot = Array.from({ length: 10 }, (_, i) => {
      const chg = [...flatChg.slice(0, DAYS - 5), 4, 5, 4, 6, 5];
      const nets = [...Array.from({ length: DAYS - 5 }, () => 1e6), 9e6, 8e6, 9e6, 8e6, 9e6];
      const amts = [...flatAmt.slice(0, DAYS - 1), 4e8];
      return mk(`00${String(i).padStart(4, "0")}`, "妖股板块", chg, nets, amts);
    });
    const stocks = [...hot, ...boringSector("A", 1), ...boringSector("B", 2), ...boringSector("C", 3), ...boringSector("D", 4)];
    const r = runRadar(input(stocks));
    expect(r.sectors.find((s) => s.sector === "妖股板块")).toBeUndefined();
    expect(r.risks.map((x) => x.name)).toContain("妖股板块");
  });
});
