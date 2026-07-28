import { describe, it, expect } from "vitest";
import {
  parseValuationRows,
  percentileBelow,
  medianPositive,
  buildValuationContext,
} from "./valuation-context";

describe("parseValuationRows", () => {
  const raw = {
    result: {
      data: [
        {
          SECURITY_CODE: "600519",
          TRADE_DATE: "2026-07-27 00:00:00",
          PE_TTM: 19.48834146,
          PB_MRQ: 5.95059327,
          PS_TTM: 9.19483665,
          BOARD_CODE: "016165",
          BOARD_NAME: "白酒Ⅱ",
        },
        { SECURITY_CODE: "600519", TRADE_DATE: "2026-07-24 00:00:00", PE_TTM: 19.6 },
      ],
    },
  };

  it("解析出交易日与三项估值指标", () => {
    const rows = parseValuationRows(raw);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.day).toBe("2026-07-27");
    expect(rows[0]!.peTtm).toBeCloseTo(19.49, 2);
    expect(rows[0]!.boardName).toBe("白酒Ⅱ");
  });

  it("结构不对返回空数组，不抛", () => {
    expect(parseValuationRows(null)).toEqual([]);
    expect(parseValuationRows({ result: {} })).toEqual([]);
  });

  it("跳过没有交易日的行", () => {
    expect(parseValuationRows({ result: { data: [{ PE_TTM: 10 }] } })).toEqual([]);
  });
});

describe("percentileBelow", () => {
  it("给出当前值高于历史多少比例的观测", () => {
    expect(percentileBelow([10, 20, 30, 40], 35)).toBe(75);
    expect(percentileBelow([10, 20, 30, 40], 5)).toBe(0);
    expect(percentileBelow([10, 20, 30, 40], 50)).toBe(100);
  });

  it("空历史返回 null", () => {
    expect(percentileBelow([], 20)).toBeNull();
  });
});

describe("medianPositive", () => {
  it("取中位数，并剔除亏损（PE<=0）——负 PE 进中位数没有意义", () => {
    expect(medianPositive([16.4, 58.9, -25.5, -383.1, 22.76])).toBeCloseTo(22.76, 2);
  });

  it("偶数个取中间两个的平均", () => {
    expect(medianPositive([10, 20, 30, 40])).toBe(25);
  });

  it("全为非正数 / 空 → null", () => {
    expect(medianPositive([-1, -2])).toBeNull();
    expect(medianPositive([])).toBeNull();
  });
});

describe("buildValuationContext", () => {
  // 一年约 240 个交易日。源是**倒序**的（index 0 = 最新），所以让 index 0 取到区间上沿 30、
  // 最老的一条是 10——当前处于历史高位，分位应接近 100。
  const history = Array.from({ length: 200 }, (_, i) => ({
    day: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
    peTtm: 30 - (i / 199) * 20,
    pbMrq: null,
    psTtm: null,
    boardCode: "016165",
    boardName: "白酒Ⅱ",
  }));

  it("产出当前值、历史分位与行业中位数", () => {
    const ctx = buildValuationContext({
      history,
      // 需 >= MIN_PEERS 个有效同行；亏损的 -25.5 会被剔除，正数中位数 = 22.76
      peerPes: [16.4, 20, 22.76, 30, 58.9, -25.5],
      boardName: "白酒Ⅱ",
    })!;
    expect(ctx.current).toBeCloseTo(30, 1); // history[0] 是最新
    expect(ctx.percentile).toBeGreaterThan(90);
    expect(ctx.industryMedian).toBeCloseTo(22.76, 2);
    expect(ctx.boardName).toBe("白酒Ⅱ");
    expect(ctx.sampleSize).toBe(200);
  });

  it("历史样本太少时不给分位——30 个点算不出可信分位，不编", () => {
    const ctx = buildValuationContext({
      history: history.slice(0, 20),
      peerPes: [20],
      boardName: "x",
    })!;
    expect(ctx.percentile).toBeNull();
  });

  it("当前 PE 为亏损（<=0）时整块不出——负 PE 的分位与对照都没有意义", () => {
    const loss = [{ ...history[0]!, peTtm: -12 }, ...history.slice(1)];
    expect(
      buildValuationContext({ history: loss, peerPes: [20], boardName: "x" }),
    ).toBeNull();
  });

  it("没有历史时返回 null", () => {
    expect(
      buildValuationContext({ history: [], peerPes: [20], boardName: "x" }),
    ).toBeNull();
  });

  it("同行样本不足时不给行业中位数，但分位仍照给", () => {
    const ctx = buildValuationContext({
      history,
      peerPes: [20, -3],
      boardName: "x",
    })!;
    expect(ctx.industryMedian).toBeNull();
    expect(ctx.percentile).not.toBeNull();
  });
});
