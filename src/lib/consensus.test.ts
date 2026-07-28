import { describe, it, expect } from "vitest";
import {
  parseConsensusDetail,
  ratingBreakdown,
  epsOutlook,
} from "./consensus";

const full = {
  orgNum: 20,
  buy: 12,
  add: 5,
  neutral: 3,
  eps: [
    { year: "2026", eps: 2.5 },
    { year: "2027", eps: 3.0 },
  ],
};

describe("parseConsensusDetail", () => {
  it("解析 EntitySignal.detail 里的一致预期结构", () => {
    const d = parseConsensusDetail(full);
    expect(d).not.toBeNull();
    expect(d!.orgNum).toBe(20);
    expect(d!.buy).toBe(12);
    expect(d!.eps).toHaveLength(2);
  });

  it("非对象 / null 一律返回 null，不抛", () => {
    expect(parseConsensusDetail(null)).toBeNull();
    expect(parseConsensusDetail("x")).toBeNull();
    expect(parseConsensusDetail(undefined)).toBeNull();
  });

  it("无机构覆盖（orgNum<=0）返回 null——没数据不硬凑", () => {
    expect(parseConsensusDetail({ orgNum: 0, buy: 0, add: 0, neutral: 0 })).toBeNull();
  });

  it("缺失的评级档补 0，缺失 eps 补空数组", () => {
    const d = parseConsensusDetail({ orgNum: 3, buy: 3 });
    expect(d).not.toBeNull();
    expect(d!.add).toBe(0);
    expect(d!.neutral).toBe(0);
    expect(d!.eps).toEqual([]);
  });

  it("year 是数字时也要认——东财实际返回的是 number，不是类型声明里写的 string", () => {
    // 库里 2004 条 consensus 全是 {"eps":2.2,"year":2025} 这种数字年份；
    // 只认字符串会把**全部** EPS 静默丢掉，界面上表现为「有覆盖但没有预期」。
    const d = parseConsensusDetail({
      orgNum: 22,
      buy: 12,
      add: 9,
      neutral: 1,
      eps: [
        { eps: 2.2, year: 2025 },
        { eps: 2.16, year: 2026 },
      ],
    });
    expect(d!.eps).toEqual([
      { year: "2025", eps: 2.2 },
      { year: "2026", eps: 2.16 },
    ]);
  });

  it("剔除 eps 里的非法条目（非数字 / 无年份）", () => {
    const d = parseConsensusDetail({
      orgNum: 2,
      buy: 2,
      eps: [{ year: "2026", eps: 1.1 }, { year: "", eps: 2 }, { year: "2027" }],
    });
    expect(d!.eps).toEqual([{ year: "2026", eps: 1.1 }]);
  });
});

describe("ratingBreakdown", () => {
  it("按 买入/增持/中性 给出计数与占比", () => {
    const slices = ratingBreakdown(parseConsensusDetail(full)!);
    expect(slices.map((s) => s.key)).toEqual(["buy", "add", "neutral"]);
    expect(slices.map((s) => s.count)).toEqual([12, 5, 3]);
    expect(slices.map((s) => s.pct)).toEqual([60, 25, 15]);
  });

  it("三档之和小于覆盖机构数时补「未披露」档——差额不隐藏、也不编造归属", () => {
    // 东财只给 买入/增持/中性 三档，减持/卖出不在源里；差额必须显性化。
    const slices = ratingBreakdown(parseConsensusDetail({ orgNum: 10, buy: 6, add: 1, neutral: 1 })!);
    const other = slices.find((s) => s.key === "other");
    expect(other).toBeDefined();
    expect(other!.count).toBe(2);
    expect(other!.label).toBe("未披露");
  });

  it("计数为 0 的档不出现在比例条里", () => {
    const slices = ratingBreakdown(parseConsensusDetail({ orgNum: 5, buy: 5 })!);
    expect(slices.map((s) => s.key)).toEqual(["buy"]);
  });
});

describe("epsOutlook", () => {
  it("给出逐年 EPS 预期，并算出后一年相对前一年的隐含增速", () => {
    const out = epsOutlook(parseConsensusDetail(full)!);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ year: "2026", eps: 2.5, growthPct: null });
    expect(out[1]!.year).toBe("2027");
    expect(out[1]!.growthPct).toBe(20); // (3.0-2.5)/2.5
  });

  it("基数为亏损或 0 时不给增速——负基数的百分比没有意义，不编", () => {
    const out = epsOutlook(
      parseConsensusDetail({
        orgNum: 3,
        buy: 3,
        eps: [{ year: "2026", eps: -0.5 }, { year: "2027", eps: 0.4 }],
      })!,
    );
    expect(out[1]!.growthPct).toBeNull();
  });

  it("按年份升序排列，源顺序不可信", () => {
    const out = epsOutlook(
      parseConsensusDetail({
        orgNum: 3,
        buy: 3,
        eps: [{ year: "2027", eps: 3 }, { year: "2026", eps: 2 }],
      })!,
    );
    expect(out.map((e) => e.year)).toEqual(["2026", "2027"]);
  });
});
