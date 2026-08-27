import { describe, expect, it } from "vitest";

import {
  ANOMALY_PCT,
  buildFundFlowCard,
  classifyPattern,
  FLAT_PRICE_PCT,
  flowStreak,
  isStale,
  stalenessDays,
  strengthBand,
  topPct,
  yi,
} from "./fund-flow";
import type { RadarBar } from "./radar/series";

const YI = 1e8;

function bar(
  day: string,
  o: Partial<RadarBar> & { net?: number | null } = {},
): RadarBar {
  return {
    day,
    close: o.close ?? 10,
    changePct: o.changePct ?? 0,
    amount: o.amount ?? 10 * YI,
    netAmount: o.net === undefined ? (o.netAmount ?? null) : o.net,
    netRatio: o.netRatio ?? null,
    turnoverRate: o.turnoverRate ?? null,
    netAmountXl: o.netAmountXl,
  };
}

/** 造 n 根同质日线，最后一根可覆写。 */
function series(n: number, last: Partial<RadarBar> & { net?: number | null } = {}) {
  const out: RadarBar[] = [];
  for (let i = 0; i < n; i++) {
    const day = `2026-01-${`${i + 1}`.padStart(2, "0")}`;
    out.push(bar(day, { net: 1 * YI, netRatio: 0.05, changePct: 0 }));
  }
  out[out.length - 1] = bar(out[out.length - 1]!.day, {
    net: 1 * YI,
    netRatio: 0.05,
    ...last,
  });
  return out;
}

describe("strengthBand — 分数到展示的唯一闸口", () => {
  it("在四个切点上分档，且只吐出五个词", () => {
    expect(strengthBand(0)).toBe("弱");
    expect(strengthBand(19.9)).toBe("弱");
    expect(strengthBand(20)).toBe("偏弱");
    expect(strengthBand(39.9)).toBe("偏弱");
    expect(strengthBand(40)).toBe("中性");
    expect(strengthBand(59.9)).toBe("中性");
    expect(strengthBand(60)).toBe("偏强");
    expect(strengthBand(79.9)).toBe("偏强");
    expect(strengthBand(80)).toBe("强");
    expect(strengthBand(100)).toBe("强");
  });

  it("永远不返回分数本身（挡住「76.3 分」这种假精确）", () => {
    const words = new Set(["强", "偏强", "中性", "偏弱", "弱"]);
    for (let s = 0; s <= 100; s += 0.5) expect(words.has(strengthBand(s))).toBe(true);
  });
});

describe("flowStreak — 连续同向天数", () => {
  it("连续净流入返回正数", () => {
    expect(flowStreak([bar("d1", { net: 1 }), bar("d2", { net: 2 }), bar("d3", { net: 3 })])).toBe(3);
  });

  it("连续净流出返回负数", () => {
    expect(flowStreak([bar("d1", { net: -1 }), bar("d2", { net: -2 })])).toBe(-2);
  });

  it("方向变了就停在换向处", () => {
    expect(flowStreak([bar("d1", { net: 5 }), bar("d2", { net: -1 }), bar("d3", { net: -2 })])).toBe(-2);
  });

  it("净额为 0 的那天中断，不算进任何一边", () => {
    // 0 既不是流入也不是流出；算进任一边都是编数。
    expect(flowStreak([bar("d1", { net: 1 }), bar("d2", { net: 0 }), bar("d3", { net: 1 })])).toBe(1);
    expect(flowStreak([bar("d1", { net: 1 }), bar("d2", { net: 0 })])).toBe(0);
  });

  it("缺失中断，且最新一根缺失时返回 0", () => {
    expect(flowStreak([bar("d1", { net: 1 }), bar("d2", { net: null }), bar("d3", { net: 1 })])).toBe(1);
    expect(flowStreak([bar("d1", { net: 1 }), bar("d2", { net: null })])).toBe(0);
  });

  it("空数组返回 0，不抛", () => {
    expect(flowStreak([])).toBe(0);
  });
});

describe("classifyPattern — 资金必须和价格合看", () => {
  it("钱进价没动 = accumulation", () => {
    expect(classifyPattern(3 * YI, 1, 50)).toBe("accumulation");
    expect(classifyPattern(3 * YI, -FLAT_PRICE_PCT + 0.1, 50)).toBe("accumulation");
  });

  it("钱出价涨 = distribution", () => {
    expect(classifyPattern(-3 * YI, 8, 50)).toBe("distribution");
  });

  it("钱进价涨 = resonance", () => {
    expect(classifyPattern(3 * YI, 8, 50)).toBe("resonance");
  });

  it("钱出价跌 = capitulation", () => {
    expect(classifyPattern(-3 * YI, -8, 50)).toBe("capitulation");
  });

  it("钱出价平不给名字（既没背离也没确认）", () => {
    expect(classifyPattern(-3 * YI, 0.5, 50)).toBe("none");
  });

  it("自身分位极高且确实是流入才算 spike", () => {
    expect(classifyPattern(3 * YI, 1, ANOMALY_PCT)).toBe("spike");
  });

  it("分位极高但净额为负 —— 那只是「比平时少流出」，不能读成放量流入", () => {
    // 这是最容易读反的一格：分位高 ≠ 流入。
    expect(classifyPattern(-3 * YI, 8, 99)).toBe("distribution");
    expect(classifyPattern(-3 * YI, -8, 99)).toBe("capitulation");
  });

  it("缺任一边就不下结论", () => {
    expect(classifyPattern(null, 5, 90)).toBe("none");
    expect(classifyPattern(3 * YI, null, 90)).toBe("none");
  });
});

describe("yi / topPct — 展示格式", () => {
  it("金额只到 0.1 亿，且取绝对值（方向由文案给）", () => {
    expect(yi(1.26e8)).toBe("1.3 亿");
    expect(yi(-1.26e8)).toBe("1.3 亿");
    expect(yi(0)).toBe("0.0 亿");
  });

  it("分位 p 转成「前 (100-p)%」，且下限是 1%", () => {
    expect(topPct(95)).toBe("前 5%");
    expect(topPct(100)).toBe("前 1%");
    expect(topPct(50)).toBe("前 50%");
  });
});

describe("buildFundFlowCard", () => {
  it("空日线返回 null", () => {
    expect(buildFundFlowCard({ bars: [], marketPct: 50 })).toBeNull();
  });

  it("超大单在库时派生出大单 = 主力 − 超大单", () => {
    const bars = series(30, { net: 25.31e8, netAmountXl: 25.04e8 });
    const c = buildFundFlowCard({ bars, marketPct: 50 })!;
    expect(c.today.xlNet).toBe(25.04e8);
    expect(c.today.bigNet).toBeCloseTo(0.27e8, -4);
  });

  it("超大单缺失时大单为 null，不拿 0 冒充", () => {
    const c = buildFundFlowCard({ bars: series(30, { net: 5e8 }), marketPct: 50 })!;
    expect(c.today.xlNet).toBeNull();
    expect(c.today.bigNet).toBeNull();
  });

  it("缺今日净额、缺 20 日历史、缺 60 日分位都会写进 missing", () => {
    const c = buildFundFlowCard({ bars: [bar("2026-01-01", { net: null })], marketPct: null })!;
    expect(c.missing).toContain("今日主力净额");
    expect(c.missing).toContain("20 日历史");
    expect(c.missing).toContain("60 日自身分位");
  });

  it("两个分位都缺时给中性 50，而不是 0（0 会把「没数据」读成「最差」）", () => {
    const c = buildFundFlowCard({ bars: series(5), marketPct: null })!;
    expect(c.selfPct).toBeNull();
    expect(c.score).toBe(50);
    expect(c.band).toBe("中性");
  });

  it("只有一个分位时就用那一个，不被 50 稀释", () => {
    const c = buildFundFlowCard({ bars: series(5), marketPct: 90 })!;
    expect(c.score).toBe(90);
    expect(c.band).toBe("强");
  });

  it("分数不含绝对金额 —— 净额放大 100 倍，档位不变", () => {
    // 绝对金额正是跨源差 50% 的那一项，拿它排序等于把口径差异排进榜单。
    const small = buildFundFlowCard({ bars: series(30, { net: 1e8, netRatio: 0.05 }), marketPct: 70 })!;
    const huge = buildFundFlowCard({ bars: series(30, { net: 100e8, netRatio: 0.05 }), marketPct: 70 })!;
    expect(huge.band).toBe(small.band);
    expect(huge.score).toBe(small.score);
  });

  it("accumulation 一定带「早期要等」的限定，不是客套", () => {
    const bars = series(30, { net: 5e8, netRatio: 0.05 });
    const c = buildFundFlowCard({ bars, marketPct: 50 })!;
    expect(c.pattern).toBe("accumulation");
    expect(c.caveats.length).toBeGreaterThanOrEqual(2);
    expect(c.caveats.join("")).toContain("前 3 个交易日的超额收益是负的");
  });

  it("每一种模式都带口径免责，一条都不能漏", () => {
    const cases: RadarBar[][] = [
      series(30, { net: 5e8 }),
      series(30, { net: -5e8, changePct: 5 }),
      series(30, { net: 5e8, changePct: 5 }),
      series(30, { net: -5e8, changePct: -5 }),
    ];
    for (const bars of cases) {
      const c = buildFundFlowCard({ bars, marketPct: 50 })!;
      expect(c.caveats.join("")).toContain("不是交易所披露的机构买卖");
    }
  });

  it("headline 里的数字都能在卡里找到出处（不许凭空造数）", () => {
    const bars = series(30, { net: 5e8, netRatio: 0.05 });
    const c = buildFundFlowCard({ bars, marketPct: 50 })!;
    // 5 日合计出现在文案里，且与 sums.d5 一致
    expect(c.headline).toContain(yi(c.sums.d5!));
  });

  it("asOf 取最后一根日线的交易日", () => {
    const c = buildFundFlowCard({ bars: series(30), marketPct: 50 })!;
    expect(c.asOf).toBe("2026-01-30");
  });
});

describe("stalenessDays / isStale — 卡面必须说出数据有多旧", () => {
  it("按自然日算差值", () => {
    expect(stalenessDays("2026-08-21", "2026-08-27")).toBe(6);
    expect(stalenessDays("2026-08-27", "2026-08-27")).toBe(0);
  });

  it("未来日期不返回负数", () => {
    expect(stalenessDays("2026-08-28", "2026-08-27")).toBe(0);
  });

  it("周末不误报，真落后才报", () => {
    // 周五(8-21)收盘的数，到周一(8-24)是 3 天——正常，不该报。
    expect(isStale("2026-08-21", "2026-08-24")).toBe(false);
    // 到周三(8-26)是 5 天——边界上仍不报。
    expect(isStale("2026-08-21", "2026-08-26")).toBe(false);
    // 到周四(8-27)是 6 天——这正是 2026-08-27 生产库的真实状态，必须报。
    expect(isStale("2026-08-21", "2026-08-27")).toBe(true);
  });

  it("日期串不合法时返回 0，不抛也不误报", () => {
    expect(stalenessDays("", "2026-08-27")).toBe(0);
    expect(isStale("x", "2026-08-27")).toBe(false);
  });
});
