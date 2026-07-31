import { describe, it, expect } from "vitest";
import {
  forwardReturn,
  maxDrawdownAfter,
  evaluateSignal,
  summarize,
} from "./backtest";
import type { RadarBar } from "./series";

function bars(chg: number[], nets: (number | null)[] = []): RadarBar[] {
  return chg.map((c, i) => ({
    day: `d${i}`,
    close: 10,
    changePct: c,
    amount: null,
    netAmount: nets[i] ?? null,
    netRatio: null,
    turnoverRate: null,
  }));
}

describe("forwardReturn", () => {
  it("信号日之后第 n 个交易日的累计收益（不含信号日当天）", () => {
    const b = bars([99, 1, 2, 3]); // 信号日在 index 0，当天涨 99% 不该计入
    expect(forwardReturn(b, 0, 1)).toBeCloseTo(1, 6);
    expect(forwardReturn(b, 0, 3)).toBeCloseTo((1.01 * 1.02 * 1.03 - 1) * 100, 6);
  });

  it("未来数据不够 → undefined（不能用短窗口冒充长窗口）", () => {
    expect(forwardReturn(bars([0, 1]), 0, 5)).toBeUndefined();
  });
});

describe("maxDrawdownAfter", () => {
  it("先涨后跌，回撤从峰值算起", () => {
    // +10% 后 -20%：峰值 1.1，谷 0.88 → 回撤 20%
    expect(maxDrawdownAfter(bars([0, 10, -20]), 0)).toBeCloseTo(20, 6);
  });

  it("一路上涨 → 回撤 0", () => {
    expect(maxDrawdownAfter(bars([0, 1, 2, 3]), 0)).toBeCloseTo(0, 6);
  });

  it("一路下跌 → 回撤等于跌幅", () => {
    expect(maxDrawdownAfter(bars([0, -5, -5]), 0)).toBeCloseTo(9.75, 2);
  });
});

describe("evaluateSignal", () => {
  it("同时给绝对收益、相对全A、相对行业", () => {
    const r = evaluateSignal({
      bars: bars([0, 5, 5]),
      index: 0,
      marketBars: bars([0, 1, 1]),
      marketIndex: 0,
      sectorBars: bars([0, 2, 2]),
      sectorIndex: 0,
    });
    expect(r.abs[1]).toBeCloseTo(5, 6);
    expect(r.vsMarket[1]).toBeCloseTo(4, 6);
    expect(r.vsSector[1]).toBeCloseTo(3, 6);
  });

  it("次日资金反转：当天净流入、次日净流出", () => {
    const r = evaluateSignal({
      bars: bars([0, 1], [1e7, -1e7]),
      index: 0,
      marketBars: bars([0, 0]),
      marketIndex: 0,
    });
    expect(r.flowReversedNextDay).toBe(true);
  });

  it("资金数据缺失时反转判定为 null，不当成 false", () => {
    const r = evaluateSignal({
      bars: bars([0, 1]),
      index: 0,
      marketBars: bars([0, 0]),
      marketIndex: 0,
    });
    expect(r.flowReversedNextDay).toBeNull();
  });
});

describe("summarize", () => {
  it("按窗口给均值与胜率", () => {
    const mk = (v: number) => ({
      abs: {},
      vsMarket: { 1: v } as Record<1, number>,
      vsSector: {},
      maxDrawdown: 5,
      flowReversedNextDay: false,
    });
    const b = summarize("EARLY", [mk(2), mk(-1), mk(4), mk(-3)]);
    expect(b.n).toBe(4);
    expect(b.meanVsMarket[1]).toBeCloseTo(0.5, 6);
    expect(b.hitRate[1]).toBeCloseTo(0.5, 6);
    expect(b.meanMaxDrawdown).toBeCloseTo(5, 6);
    expect(b.flowReversalRate).toBe(0);
  });

  it("空桶不炸，均值为空", () => {
    const b = summarize("空", []);
    expect(b.n).toBe(0);
    expect(b.meanMaxDrawdown).toBeNull();
  });
});
