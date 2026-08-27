import { describe, expect, it } from "vitest";

import { buildImportPatch, namesRoughlyMatch } from "./holding-import";

describe("namesRoughlyMatch", () => {
  it("相等 / 互含 / 带星带空格都算同一个", () => {
    expect(namesRoughlyMatch("贵州茅台", "贵州茅台")).toBe(true);
    expect(namesRoughlyMatch("贵州 茅台", "贵州茅台")).toBe(true);
    expect(namesRoughlyMatch("宁德时代A", "宁德时代")).toBe(true);
    expect(namesRoughlyMatch("中国平安", "中国平安")).toBe(true);
  });
  it("不同的票不算（平安银行 vs 中国平安）", () => {
    expect(namesRoughlyMatch("平安银行", "中国平安")).toBe(false);
    expect(namesRoughlyMatch("贵州茅台", "五粮液")).toBe(false);
    expect(namesRoughlyMatch("", "贵州茅台")).toBe(false);
  });
});

describe("buildImportPatch", () => {
  it("只写非 null 字段，绝不清已有值", () => {
    expect(buildImportPatch({ costBasis: 1680.5, shares: 100 })).toEqual({
      status: "HOLDING",
      costBasis: 1680.5,
      shares: 100,
    });
    expect(buildImportPatch({ costBasis: null, shares: 100 })).toEqual({
      status: "HOLDING",
      shares: 100,
    });
    expect(buildImportPatch({ costBasis: null, shares: null })).toEqual({ status: "HOLDING" });
  });
});
