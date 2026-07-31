import { describe, it, expect } from "vitest";
import {
  parseTencentQfq,
  isOneWord,
  gapVsReported,
  hasMechanicalGap,
} from "./qfq";

/** 夹具从真实响应拷贝（2026-07-31 实测 web.ifzq.gtimg.cn，sh600519）。 */
const REAL = {
  code: 0,
  data: {
    sh600519: {
      qfqday: [
        ["2026-07-17", "1269.010", "1253.000", "1269.330", "1238.980", "58417.000"],
        ["2026-07-20", "1270.000", "1327.500", "1329.000", "1266.000", "106151.000"],
        ["2026-07-21", "1338.980", "1308.000", "1344.700", "1296.870", "77148.000"],
      ],
    },
  },
};

describe("parseTencentQfq", () => {
  it("字段序是 [日期, 开, 收, 高, 低, 量]——不是 OHLC，认错会把收盘价当最高价", () => {
    const rows = parseTencentQfq(REAL, "sh600519");
    expect(rows).toHaveLength(3);
    const d0 = rows[0]!;
    expect(d0.day).toBe("2026-07-17");
    expect(d0.open).toBeCloseTo(1269.01, 2);
    expect(d0.close).toBeCloseTo(1253.0, 2);
    expect(d0.high).toBeCloseTo(1269.33, 2);
    expect(d0.low).toBeCloseTo(1238.98, 2);
  });

  it("解出来的高/低必须能包住开/收，否则就是字段序认错了", () => {
    for (const r of parseTencentQfq(REAL, "sh600519")) {
      expect(r.high).toBeGreaterThanOrEqual(Math.max(r.open, r.close));
      expect(r.low).toBeLessThanOrEqual(Math.min(r.open, r.close));
    }
  });

  it("按日期升序返回", () => {
    expect(parseTencentQfq(REAL, "sh600519").map((r) => r.day)).toEqual([
      "2026-07-17",
      "2026-07-20",
      "2026-07-21",
    ]);
  });

  it("结构不对 / 找不到该 symbol → 空数组，不抛", () => {
    expect(parseTencentQfq(null, "sh600519")).toEqual([]);
    expect(parseTencentQfq({ code: -1 }, "sh600519")).toEqual([]);
    expect(parseTencentQfq(REAL, "sz000001")).toEqual([]);
    expect(parseTencentQfq({ data: { sh600519: { qfqday: "x" } } }, "sh600519")).toEqual([]);
  });

  it("价格 ≤0 的坏行丢掉", () => {
    const bad = { data: { sh600519: { qfqday: [["2026-07-17", "0", "0", "0", "0", "1"]] } } };
    expect(parseTencentQfq(bad, "sh600519")).toEqual([]);
  });
});

describe("isOneWord（一字板）", () => {
  it("开=收=高=低 才是一字", () => {
    expect(isOneWord({ day: "d", open: 10, close: 10, high: 10, low: 10, volume: 1 })).toBe(true);
  });

  it("盘中有波动就不是一字——哪怕收在涨停价", () => {
    expect(isOneWord({ day: "d", open: 9.5, close: 10, high: 10, low: 9.4, volume: 1 })).toBe(false);
    expect(isOneWord({ day: "d", open: 10, close: 10, high: 10.01, low: 10, volume: 1 })).toBe(false);
  });
});

describe("gapVsReported（复权价与上报涨跌幅的偏差）", () => {
  it("前复权序列与官方涨跌幅应当自洽，偏差接近 0", () => {
    // 10 → 11，官方 +10%
    expect(gapVsReported(10, 11, 10)!).toBeCloseTo(0, 6);
  });

  it("未复权序列在除权日会算出巨大偏差——这正是旧口径的问题", () => {
    // 收盘 10 → 5（10送10），官方涨跌幅 0
    expect(Math.abs(gapVsReported(10, 5, 0)!)).toBeCloseTo(50, 6);
  });

  it("前收 ≤0 返回 null，不产生 Infinity", () => {
    expect(gapVsReported(0, 5, 1)).toBeNull();
    expect(gapVsReported(-1, 5, 1)).toBeNull();
  });
});

describe("hasMechanicalGap（复权价缺失时必须退回未复权，不能静默跳过）", () => {
  const row = (close: number, adj: number | null, chg: number) => ({ close, adjClose: adj, changePct: chg });

  it("前复权序列自洽 → 不算异动", () => {
    expect(hasMechanicalGap([row(10, 6.0, 0), row(11, 6.6, 10)])).toBe(false);
  });

  it("前复权与官方涨跌幅对不上 3pp 以上 → 异动", () => {
    expect(hasMechanicalGap([row(10, 6.0, 0), row(11, 6.6, 4)])).toBe(true);
  });

  it("完全没有复权价 → 退回未复权 + 宽阈值（>11pp）", () => {
    expect(hasMechanicalGap([row(10, null, 0), row(9.5, null, -5)])).toBe(false);
    expect(hasMechanicalGap([row(10, null, 0), row(5, null, 0)])).toBe(true);
  });

  it("**老行有复权价、最近几行没有** → 那几天退回未复权判断，不是跳过不判", () => {
    // 新交易日的四价还没回填：最后一对必须仍然被检查
    const rows = [row(10, 6.0, 0), row(11, 6.6, 10), row(5, null, 0)];
    expect(hasMechanicalGap(rows)).toBe(true);
  });

  it("窗口只看最近 N 对，更早的断裂不算数（20 日前除权不影响今天可比性）", () => {
    const old = [row(10, null, 0), row(5, null, 0)];
    const rest = Array.from({ length: 6 }, () => row(5, null, 0));
    expect(hasMechanicalGap([...old, ...rest], 5)).toBe(false);
  });

  it("价格 ≤0 的行不参与判断，不产生 Infinity", () => {
    expect(hasMechanicalGap([row(0, null, 0), row(5, null, 0)])).toBe(false);
  });
});
