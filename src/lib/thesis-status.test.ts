import { describe, it, expect } from "vitest";
import {
  dirLabel,
  thesisActivityStatus,
  sortDimensionsByActivity,
  isThesisAlert,
  MATERIAL_ALERT_THRESHOLD,
  summarizeEntityLens,
} from "./thesis-status";

const sig = (dimensionKey: string, direction: string, materiality: number) => ({
  dimensionKey,
  direction,
  materiality,
  note: "n",
});

describe("dirLabel", () => {
  it("maps direction to neutral labels (no 涨跌 words)", () => {
    expect(dirLabel("bull")).toBe("偏兑现");
    expect(dirLabel("bear")).toBe("偏风险");
    expect(dirLabel("neutral")).toBe("中性");
  });
});

describe("thesisActivityStatus", () => {
  it("is quiet with no signals", () => {
    const s = thesisActivityStatus([]);
    expect(s.active).toBe(false);
    expect(s.headline).toContain("静音");
  });
  it("highlights the most material signal", () => {
    const s = thesisActivityStatus([sig("A", "bull", 40), sig("B", "bear", 80)]);
    expect(s.active).toBe(true);
    expect(s.count).toBe(2);
    expect(s.top?.dimensionKey).toBe("B");
    expect(s.headline).toContain("B");
    expect(s.headline).toContain("偏风险");
  });
});

describe("summarizeEntityLens", () => {
  it("picks the most material signal as the lens verdict", () => {
    const s = summarizeEntityLens([
      { dimensionKey: "A", direction: "bull", materiality: 30 },
      { dimensionKey: "B", direction: "bear", materiality: 70 },
    ]);
    expect(s.topDimension).toBe("B");
    expect(s.topDirection).toBe("bear");
    expect(s.dimCount).toBe(2);
    expect(s.headline).toContain("2 个维度");
    expect(s.headline).toContain("偏风险");
  });
  it("is empty-safe", () => {
    const s = summarizeEntityLens([]);
    expect(s.dimCount).toBe(0);
    expect(s.headline).toContain("未触及");
  });
});

describe("isThesisAlert", () => {
  it("only fires at or above the material threshold", () => {
    expect(isThesisAlert(MATERIAL_ALERT_THRESHOLD)).toBe(true);
    expect(isThesisAlert(MATERIAL_ALERT_THRESHOLD + 20)).toBe(true);
    expect(isThesisAlert(MATERIAL_ALERT_THRESHOLD - 1)).toBe(false);
    expect(isThesisAlert(0)).toBe(false);
  });
});

describe("sortDimensionsByActivity", () => {
  it("floats active dimensions (by max materiality) to the front, keeps quiet ones stable", () => {
    const dims = [{ key: "A" }, { key: "B" }, { key: "C" }];
    const signals = [sig("C", "bull", 70), sig("A", "bear", 30)];
    expect(sortDimensionsByActivity(dims, signals).map((d) => d.key)).toEqual([
      "C",
      "A",
      "B",
    ]);
  });
  it("is a no-op ordering when there are no signals", () => {
    const dims = [{ key: "A" }, { key: "B" }];
    expect(sortDimensionsByActivity(dims, []).map((d) => d.key)).toEqual(["A", "B"]);
  });
});
