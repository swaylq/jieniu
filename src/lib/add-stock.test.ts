import { describe, it, expect } from "vitest";

import { classifyStockQuery, normalizeStockName } from "./add-stock";

describe("classifyStockQuery", () => {
  it("treats a valid 6-digit A-share code as a code (SH/SZ/ChiNext/BSE prefixes)", () => {
    expect(classifyStockQuery("600519")).toEqual({ kind: "code", code: "600519" });
    expect(classifyStockQuery("000001")).toEqual({ kind: "code", code: "000001" });
    expect(classifyStockQuery("300750")).toEqual({ kind: "code", code: "300750" });
    expect(classifyStockQuery("688027")).toEqual({ kind: "code", code: "688027" });
    expect(classifyStockQuery("830799")).toEqual({ kind: "code", code: "830799" }); // 北交所
  });

  it("trims surrounding whitespace before classifying a code", () => {
    expect(classifyStockQuery("  600519 ")).toEqual({ kind: "code", code: "600519" });
  });

  it("rejects 6-digit numbers that are not A-share prefixes (1/2/5/9 开头)", () => {
    expect(classifyStockQuery("100001")).toEqual({ kind: "invalid" }); // 国债
    expect(classifyStockQuery("511990")).toEqual({ kind: "invalid" }); // 货基 5 开头
  });

  it("rejects blank and non-6-digit pure numbers", () => {
    expect(classifyStockQuery("   ")).toEqual({ kind: "invalid" });
    expect(classifyStockQuery("12345")).toEqual({ kind: "invalid" });
    expect(classifyStockQuery("1234567")).toEqual({ kind: "invalid" });
  });

  it("treats free text as a name to resolve", () => {
    expect(classifyStockQuery("贵州茅台")).toEqual({ kind: "name", name: "贵州茅台" });
    expect(classifyStockQuery("  绿城中国 ")).toEqual({ kind: "name", name: "绿城中国" });
  });
});

describe("normalizeStockName", () => {
  it("strips all whitespace", () => {
    expect(normalizeStockName("贵州 茅台 ")).toBe("贵州茅台");
    expect(normalizeStockName("  中芯\t国际\n")).toBe("中芯国际");
  });
});
