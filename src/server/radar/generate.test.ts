import { describe, it, expect } from "vitest";
import { numbersAreSubsetOf } from "./generate";

describe("numbersAreSubsetOf（AI 润色的数值闸门）", () => {
  it("原样保留数字 → 通过", () => {
    expect(numbersAreSubsetOf("近 3 日净流入 42.0 亿", "近 3 日主力资金合计 +42.0 亿")).toBe(true);
  });

  it("凭空多出一个数字 → 拒绝", () => {
    expect(numbersAreSubsetOf("近 3 日净流入 42.0 亿，占成交额 7.5%", "近 3 日主力资金合计 +42.0 亿")).toBe(false);
  });

  it("把 4.2 说成 4.3 → 拒绝", () => {
    expect(numbersAreSubsetOf("5 日涨了 4.3%", "5 日涨幅 4.2%")).toBe(false);
  });

  it("不含数字的改写 → 通过", () => {
    expect(numbersAreSubsetOf("资金还在往里进", "近 3 日主力资金持续净流入")).toBe(true);
  });
});

import { matchesRisk } from "./generate";

describe("matchesRisk（生命周期里「今天是不是变成追高风险了」的判据）", () => {
  const sectorRisk = { name: "教育", ticker: null };
  const stockRisk = { name: "北汽蓝谷(600733)", ticker: "600733" };

  it("行业信号按名字匹配", () => {
    expect(matchesRisk({ entityName: "教育", ticker: null }, [sectorRisk])).toBe(true);
    expect(matchesRisk({ entityName: "银行", ticker: null }, [sectorRisk])).toBe(false);
  });

  it("**两个 null 不算相等**——否则任一行业过热会把所有行业信号打成风险", () => {
    expect(matchesRisk({ entityName: "银行", ticker: null }, [{ name: "教育", ticker: null }])).toBe(false);
  });

  it("个股按 ticker 匹配", () => {
    expect(matchesRisk({ entityName: "x", ticker: "600733" }, [stockRisk])).toBe(true);
    expect(matchesRisk({ entityName: "x", ticker: "000001" }, [stockRisk])).toBe(false);
  });

  it("个股不会被行业风险误伤", () => {
    expect(matchesRisk({ entityName: "x", ticker: "600733" }, [sectorRisk])).toBe(false);
  });
});
