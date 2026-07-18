import { describe, it, expect } from "vitest";
import { sparklineCoords, rangeValues, availableRanges } from "./spark";

describe("rangeValues", () => {
  it("returns the last n points", () => {
    expect(rangeValues([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5]);
  });
  it("returns the whole series when shorter than n", () => {
    expect(rangeValues([1, 2], 30)).toEqual([1, 2]);
  });
});

describe("availableRanges", () => {
  it("offers all four ranges for a full ~1Y series", () => {
    expect(availableRanges(250).map((r) => r.key)).toEqual([
      "1M",
      "3M",
      "6M",
      "1Y",
    ]);
  });
  it("offers only ranges the data covers", () => {
    expect(availableRanges(30).map((r) => r.key)).toEqual(["1M", "3M"]);
  });
  it("offers nothing for a single point", () => {
    expect(availableRanges(1)).toEqual([]);
  });
});

describe("sparklineCoords", () => {
  it("maps evenly on x and spans the full width", () => {
    const c = sparklineCoords([1, 2, 3], 100, 50);
    expect(c).toHaveLength(3);
    expect(c[0]!.x).toBe(0);
    expect(c[2]!.x).toBe(100);
  });
  it("plots higher values higher (smaller y)", () => {
    const c = sparklineCoords([1, 10], 100, 50);
    expect(c[1]!.y).toBeLessThan(c[0]!.y);
  });
  it("centers a flat series instead of dividing by zero", () => {
    const c = sparklineCoords([5, 5, 5], 90, 40);
    expect(c.every((p) => p.y === 20)).toBe(true);
  });
  it("returns [] for fewer than two points", () => {
    expect(sparklineCoords([1], 100, 50)).toEqual([]);
  });
});
