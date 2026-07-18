import { describe, it, expect } from "vitest";

import { safeReturnTo } from "./format";

describe("safeReturnTo", () => {
  it("放行站内绝对路径（含 query）", () => {
    expect(safeReturnTo("/entity/abc")).toBe("/entity/abc");
    expect(safeReturnTo("/news/x?tab=1")).toBe("/news/x?tab=1");
  });

  it("拒绝开放重定向，回退到 /", () => {
    expect(safeReturnTo("//evil.com")).toBe("/");
    expect(safeReturnTo("/\\evil.com")).toBe("/");
    expect(safeReturnTo("http://evil.com")).toBe("/");
    expect(safeReturnTo("evil")).toBe("/");
  });

  it("空/缺省回退到 /", () => {
    expect(safeReturnTo(null)).toBe("/");
    expect(safeReturnTo(undefined)).toBe("/");
    expect(safeReturnTo("")).toBe("/");
  });
});
