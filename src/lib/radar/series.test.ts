import { describe, it, expect } from "vitest";
import {
  returnOverDays,
  positiveFlowDays,
  netFlowSum,
  percentileRank,
  selfPercentile,
  mean,
  amountRatioVs,
  type RadarBar,
} from "./series";

function bar(
  day: string,
  close: number,
  net: number | null = null,
  amount: number | null = null,
): RadarBar {
  return {
    day,
    close,
    changePct: 0,
    amount,
    netAmount: net,
    netRatio: null,
    turnoverRate: null,
  };
}

function chgBar(day: string, changePct: number): RadarBar {
  return {
    day,
    close: 10,
    changePct,
    amount: null,
    netAmount: null,
    netRatio: null,
    turnoverRate: null,
  };
}

describe("returnOverDays", () => {
  it("N 日累计涨幅 = 逐日涨跌幅**连乘**（不是相加）", () => {
    const bars = [chgBar("d1", 0), chgBar("d2", 10), chgBar("d3", 10)];
    // 1.1 × 1.1 = 1.21
    expect(returnOverDays(bars, 2)).toBeCloseTo(21, 6);
  });

  it("除权除息日不能把分红当下跌——用官方涨跌幅而不是未复权收盘价之比", () => {
    // 收盘价从 10 掉到 9（分红 1 元），但当天官方涨跌幅是 0
    const bars: RadarBar[] = [
      { ...chgBar("d1", 0), close: 10 },
      { ...chgBar("d2", 0), close: 9 },
      { ...chgBar("d3", 1), close: 9.09 },
    ];
    expect(returnOverDays(bars, 2)).toBeCloseTo(1, 6);
  });

  it("历史不够长返回 null——不拿最早那根凑数", () => {
    expect(returnOverDays([chgBar("d1", 1), chgBar("d2", 1)], 5)).toBeNull();
    expect(returnOverDays([], 1)).toBeNull();
  });
});

describe("positiveFlowDays / netFlowSum", () => {
  const bars = [
    bar("d1", 1, -100),
    bar("d2", 1, 50),
    bar("d3", 1, -20),
    bar("d4", 1, 80),
    bar("d5", 1, 30),
  ];

  it("只数最近 N 天里净额为正的天数", () => {
    expect(positiveFlowDays(bars, 3)).toBe(2); // d3,d4,d5 → +80,+30
    expect(positiveFlowDays(bars, 5)).toBe(3);
  });

  it("净额缺失的那天不算净流入（也不算净流出）", () => {
    expect(positiveFlowDays([bar("d1", 1, null), bar("d2", 1, 5)], 2)).toBe(1);
  });

  it("N 日净额合计", () => {
    expect(netFlowSum(bars, 3)).toBeCloseTo(90, 6);
  });
});

describe("percentileRank", () => {
  it("最大值 100、最小值 0", () => {
    expect(percentileRank([1, 2, 3, 4, 5], 5)).toBe(100);
    expect(percentileRank([1, 2, 3, 4, 5], 1)).toBe(0);
  });

  it("中位数约 50", () => {
    expect(percentileRank([1, 2, 3, 4, 5], 3)).toBeCloseTo(50, 0);
  });

  it("样本为空返回 50（中性），不返回 0——否则「没数据」会被当成「最差」", () => {
    expect(percentileRank([], 3)).toBe(50);
  });

  it("并列取中点秩：3 个并列最小值各得 1/(n-1)，不是各自 0", () => {
    expect(percentileRank([1, 1, 1, 5], 5)).toBe(100);
    expect(percentileRank([1, 1, 1, 5], 1)).toBeCloseTo(100 / 3, 6);
  });

  it("样本外的值 clamp 在 0..100（selfPercentile 的今天不在历史样本里）", () => {
    expect(percentileRank([1, 2, 3], 99)).toBe(100);
    expect(percentileRank([1, 2, 3], -99)).toBe(0);
  });
});

describe("selfPercentile — 当前值在自身历史里的位置（§3 第4项：相对自身60日异常程度）", () => {
  it("今天创 60 日新高 → 接近 100", () => {
    const bars = Array.from({ length: 60 }, (_, i) => bar(`d${i}`, 1, i));
    expect(selfPercentile(bars, (b) => b.netAmount, 60)).toBe(100);
  });

  it("历史样本太少返回 null——不足以谈「异常」", () => {
    const bars = [bar("d1", 1, 5), bar("d2", 1, 9)];
    expect(selfPercentile(bars, (b) => b.netAmount, 60, 20)).toBeNull();
  });
});

describe("amountRatioVs — 当日成交额 / 过去 N 日均额", () => {
  it("放量 2 倍", () => {
    const bars = [
      bar("d1", 1, null, 100),
      bar("d2", 1, null, 100),
      bar("d3", 1, null, 100),
      bar("d4", 1, null, 200),
    ];
    expect(amountRatioVs(bars, 3)).toBeCloseTo(2, 6);
  });

  it("均额里不含当日（否则放量会被自己稀释）", () => {
    const bars = [bar("d1", 1, null, 100), bar("d2", 1, null, 300)];
    expect(amountRatioVs(bars, 1)).toBeCloseTo(3, 6);
  });

  it("缺成交额返回 null", () => {
    expect(amountRatioVs([bar("d1", 1), bar("d2", 1)], 1)).toBeNull();
  });
});

describe("mean", () => {
  it("空数组返回 null", () => {
    expect(mean([])).toBeNull();
    expect(mean([1, 2, 3])).toBeCloseTo(2, 6);
  });
});
