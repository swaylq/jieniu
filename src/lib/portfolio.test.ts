import { describe, it, expect } from "vitest";
import {
  normalizeHoldingStatus,
  sanitizeHoldingNumbers,
  partitionPortfolio,
  portfolioWeightTotal,
  weightGapHint,
} from "./portfolio";

describe("normalizeHoldingStatus", () => {
  it("defaults unknown to WATCH", () => {
    expect(normalizeHoldingStatus("HOLDING")).toBe("HOLDING");
    expect(normalizeHoldingStatus("CLOSED")).toBe("CLOSED");
    expect(normalizeHoldingStatus("WATCH")).toBe("WATCH");
    expect(normalizeHoldingStatus(null)).toBe("WATCH");
    expect(normalizeHoldingStatus("garbage")).toBe("WATCH");
  });
});

describe("sanitizeHoldingNumbers", () => {
  it("keeps valid, nulls negatives and out-of-range weights", () => {
    expect(sanitizeHoldingNumbers({ costBasis: 157.3, weight: 12, targetWeight: 20, shares: 100 })).toEqual({
      costBasis: 157.3,
      shares: 100,
      weight: 12,
      targetWeight: 20,
    });
    expect(sanitizeHoldingNumbers({ costBasis: -5, weight: 120, targetWeight: -1, shares: -10 })).toEqual({
      costBasis: null,
      shares: null,
      weight: null,
      targetWeight: null,
    });
    expect(sanitizeHoldingNumbers({}).costBasis).toBe(null);
    expect(sanitizeHoldingNumbers({ weight: NaN }).weight).toBe(null);
  });
});

describe("partitionPortfolio", () => {
  it("splits holdings from watching, drops CLOSED", () => {
    const items = [
      { status: "HOLDING", id: "a" },
      { status: "WATCH", id: "b" },
      { status: "CLOSED", id: "c" },
      { status: "HOLDING", id: "d" },
    ];
    const { holdings, watching } = partitionPortfolio(items);
    expect(holdings.map((h) => h.id)).toEqual(["a", "d"]);
    expect(watching.map((w) => w.id)).toEqual(["b"]);
  });
});

describe("portfolioWeightTotal", () => {
  it("sums weights, ignores null, rounds to 1dp", () => {
    expect(portfolioWeightTotal([{ weight: 12.5 }, { weight: 7.2 }, { weight: null }])).toBe(19.7);
    expect(portfolioWeightTotal([])).toBe(0);
  });
});

describe("weightGapHint", () => {
  it("compares current vs target as observation only", () => {
    expect(weightGapHint(10, 20)).toBe("below-target");
    expect(weightGapHint(25, 20)).toBe("above-target");
    expect(weightGapHint(20, 20)).toBe("on-target");
    expect(weightGapHint(null, 20)).toBe("unset");
    expect(weightGapHint(10, null)).toBe("unset");
  });
});
