import { describe, it, expect } from "vitest";
import { parseSinaMoneyFlow } from "./sina-flow";

/**
 * 夹具**从真实响应拷贝**（2026-07-31 实测 sz000812 / sh600519），不照类型声明手写——
 * 「类型声明不是事实」那条教训：手写夹具只能证明实现符合我的想象。
 */
const REAL = [
  {
    opendate: "2026-07-30",
    trade: "3.4900",
    changeratio: "0.0356083",
    turnover: "539.082",
    netamount: "19522575.8900",
    ratioamount: "0.13656",
    r0_net: "9695941.2000",
    r0_ratio: "0.06782287",
    r0x_ratio: "62.2997",
    cnt_r0x_ratio: "1",
    cate_ra: "-0.130496",
    cate_na: "-159592504.1600",
  },
  {
    opendate: "2026-07-29",
    trade: "3.3700",
    changeratio: "-0.00294985",
    turnover: "300.5",
    netamount: "-5000000.00",
    ratioamount: "-0.05",
    r0_net: "-1000.0",
    r0_ratio: "-0.01",
    r0x_ratio: "10",
    cnt_r0x_ratio: "0",
    cate_ra: "0.01",
    cate_na: "100.0",
  },
];

describe("parseSinaMoneyFlow", () => {
  it("把 changeratio 小数转成百分数", () => {
    const rows = parseSinaMoneyFlow(REAL); // 升序：[07-29, 07-30]
    expect(rows[0]!.changePct).toBeCloseTo(-0.295, 3);
    expect(rows[1]!.changePct).toBeCloseTo(3.56, 2);
  });

  it("按日期升序返回，日期取 YYYY-MM-DD", () => {
    const rows = parseSinaMoneyFlow(REAL);
    expect(rows.map((r) => r.day)).toEqual(["2026-07-29", "2026-07-30"]);
  });

  it("主力净额原样保留（元）", () => {
    const rows = parseSinaMoneyFlow(REAL);
    expect(rows[1]!.netAmount).toBeCloseTo(19522575.89, 2);
  });

  it("成交额由 净额/占比 反推——负占比也要取绝对口径", () => {
    const rows = parseSinaMoneyFlow(REAL);
    // 19522575.89 / 0.13656 = 142958.6 万元
    expect(rows[1]!.amount! / 1e8).toBeCloseTo(1.4296, 3);
    // -5000000 / -0.05 = 1亿
    expect(rows[0]!.amount! / 1e8).toBeCloseTo(1.0, 3);
  });

  it("占比接近 0 时不反推成交额（除零会得到天文数字）", () => {
    const rows = parseSinaMoneyFlow([
      { ...REAL[0], ratioamount: "0.0000001", netamount: "100.0" },
    ]);
    expect(rows[0]!.amount).toBeNull();
  });

  it("换手率 = turnover/100（实测 57.4943 ↔ 0.57%）", () => {
    const rows = parseSinaMoneyFlow([{ ...REAL[0], turnover: "57.4943" }]);
    expect(rows[0]!.turnoverRate).toBeCloseTo(0.5749, 4);
  });

  it("结构不对 / 收盘价非正 → 丢弃该行，不抛", () => {
    expect(parseSinaMoneyFlow(null)).toEqual([]);
    expect(parseSinaMoneyFlow({ __ERROR: 3 })).toEqual([]);
    expect(parseSinaMoneyFlow([{ ...REAL[0], trade: "0.0000" }])).toEqual([]);
    expect(parseSinaMoneyFlow([{ ...REAL[0], opendate: "x" }])).toEqual([]);
  });
});
