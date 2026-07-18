import { describe, it, expect } from "vitest";
import {
  adoptDimensions,
  SENSITIVITY_THRESHOLD,
  personalizeSignals,
  activeDimensions,
  activationBackfill,
  userDimensionStatus,
  normalizeUserDimensions,
  type UserDimension,
} from "./user-thesis";

const base = [
  { key: "订单", watch: "大客户订单", bull: "新签", bear: "流失" },
  { key: "毛利", watch: "毛利率", bull: "提升", bear: "下滑" },
];

describe("adoptDimensions", () => {
  it("adopts every base dimension with safe defaults", () => {
    const dims = adoptDimensions(base);
    expect(dims).toHaveLength(2);
    expect(dims[0]).toEqual({
      key: "订单",
      watch: "大客户订单",
      bull: "新签",
      bear: "流失",
      priority: false,
      sensitivity: "normal",
      muted: false,
      source: "base",
    });
  });
});

describe("SENSITIVITY_THRESHOLD", () => {
  it("high triggers more easily than low (lower materiality bar)", () => {
    expect(SENSITIVITY_THRESHOLD.high).toBeLessThan(SENSITIVITY_THRESHOLD.normal);
    expect(SENSITIVITY_THRESHOLD.normal).toBeLessThan(SENSITIVITY_THRESHOLD.low);
  });
});

describe("activeDimensions", () => {
  it("excludes muted dimensions", () => {
    const dims = adoptDimensions(base);
    dims[1]!.muted = true;
    expect(activeDimensions(dims).map((d) => d.key)).toEqual(["订单"]);
  });
});

describe("personalizeSignals", () => {
  const dims: UserDimension[] = [
    { key: "订单", watch: "", bull: "", bear: "", priority: true, sensitivity: "normal", muted: false, source: "base" },
    { key: "毛利", watch: "", bull: "", bear: "", priority: false, sensitivity: "low", muted: false, source: "base" },
    { key: "现金", watch: "", bull: "", bear: "", priority: false, sensitivity: "normal", muted: true, source: "base" },
  ];
  const sig = (dimensionKey: string, materiality: number) => ({
    dimensionKey,
    materiality,
    note: "",
  });

  it("drops signals on muted dimensions", () => {
    const out = personalizeSignals(dims, [sig("现金", 99)]);
    expect(out).toHaveLength(0);
  });

  it("drops signals below the dimension's sensitivity threshold", () => {
    // 毛利 is low sensitivity → threshold 80; a materiality-70 signal is filtered out
    expect(personalizeSignals(dims, [sig("毛利", 70)])).toHaveLength(0);
    expect(personalizeSignals(dims, [sig("毛利", 85)])).toHaveLength(1);
  });

  it("drops signals whose dimension is not in the user's thesis", () => {
    expect(personalizeSignals(dims, [sig("未知维度", 100)])).toHaveLength(0);
  });

  it("keeps at-threshold signals and orders priority dims first, then by materiality", () => {
    const out = personalizeSignals(dims, [
      sig("毛利", 90), // low sens, passes (>=80), non-priority
      sig("订单", 60), // normal sens, passes (>=60), priority
      sig("订单", 95), // priority, higher materiality
    ]);
    expect(out.map((s) => [s.dimensionKey, s.materiality])).toEqual([
      ["订单", 95],
      ["订单", 60],
      ["毛利", 90],
    ]);
  });
});

describe("activationBackfill", () => {
  const d = (
    key: string,
    sensitivity: "low" | "normal" | "high",
    muted = false,
  ): UserDimension => ({
    key,
    watch: "",
    bull: "",
    bear: "",
    priority: false,
    sensitivity,
    muted,
    source: "base",
  });
  const dims = [d("订单", "normal"), d("毛利", "low"), d("现金", "normal", true)];
  const sig = (dimensionKey: string, materiality: number) => ({
    dimensionKey,
    materiality,
    note: "",
    newsTitle: "",
  });

  it("counts touched (active dims) vs would-alert (past threshold), samples ≤3", () => {
    const bf = activationBackfill(dims, [
      sig("订单", 70), // touched + alert (normal→60)
      sig("订单", 30), // touched, below threshold
      sig("毛利", 90), // touched + alert (low→80)
      sig("毛利", 50), // touched, below threshold
      sig("现金", 99), // muted → not touched
      sig("未知", 99), // not in thesis → not touched
    ]);
    expect(bf.touchedCount).toBe(4);
    expect(bf.wouldAlertCount).toBe(2);
    expect(bf.samples).toHaveLength(2);
    // 均非重点 → 按材料度降序：毛利90 先于 订单70
    expect(bf.samples.map((s) => s.dimensionKey)).toEqual(["毛利", "订单"]);
  });

  it("returns zeros when nothing touches the thesis", () => {
    expect(activationBackfill(dims, [sig("未知", 100)])).toEqual({
      touchedCount: 0,
      wouldAlertCount: 0,
      samples: [],
    });
  });
});

describe("userDimensionStatus", () => {
  const dims = adoptDimensions([
    { key: "订单", watch: "", bull: "", bear: "" },
  ]);
  it("returns muted/priority for a known dimension", () => {
    dims[0]!.priority = true;
    expect(userDimensionStatus(dims, "订单")).toEqual({ muted: false, priority: true });
  });
  it("returns null for a dimension not in the thesis", () => {
    expect(userDimensionStatus(dims, "未知")).toBeNull();
  });
});

describe("normalizeUserDimensions", () => {
  it("fills defaults, drops keyless entries, and clamps sensitivity", () => {
    const out = normalizeUserDimensions([
      { key: "订单", sensitivity: "high", priority: true },
      { key: "", watch: "x" }, // dropped: no key
      { key: "毛利", sensitivity: "bogus" }, // clamped to normal
      { watch: "y" }, // dropped: no key
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ key: "订单", sensitivity: "high", priority: true, muted: false });
    expect(out[1]).toMatchObject({ key: "毛利", sensitivity: "normal" });
  });

  it("preserves source when provided, defaults to user otherwise", () => {
    const out = normalizeUserDimensions([
      { key: "a", source: "base" },
      { key: "b" },
    ]);
    expect(out[0]!.source).toBe("base");
    expect(out[1]!.source).toBe("user");
  });
});
