import { describe, it, expect } from "vitest";
import { planFeatures, hasFeature, normalizePlan } from "./plan";

describe("plan tiers (会员限制已移除——全部功能对所有人开放)", () => {
  it("every tier has all features, including market-ai", () => {
    for (const tier of ["STANDARD", "PLUS"] as const) {
      expect(hasFeature(tier, "thesis-watch")).toBe(true);
      expect(hasFeature(tier, "material-alerts")).toBe(true);
      expect(hasFeature(tier, "ecosystem")).toBe(true);
      expect(hasFeature(tier, "market-ai")).toBe(true);
    }
  });
  it("planFeatures returns the full set regardless of tier", () => {
    expect(planFeatures("STANDARD")).toEqual(planFeatures("PLUS"));
    expect(planFeatures("STANDARD")).toContain("market-ai");
  });
  it("normalizePlan defaults unknown/empty to STANDARD", () => {
    expect(normalizePlan("PLUS")).toBe("PLUS");
    expect(normalizePlan("STANDARD")).toBe("STANDARD");
    expect(normalizePlan(null)).toBe("STANDARD");
    expect(normalizePlan(undefined)).toBe("STANDARD");
    expect(normalizePlan("garbage")).toBe("STANDARD");
  });
});
