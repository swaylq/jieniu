import { describe, it, expect } from "vitest";
import { driftDecision, driftHeadline, fallbackChallenge } from "./drift";

describe("driftDecision", () => {
  it("does not challenge non-build actions", () => {
    for (const action of ["SELL", "TRIM", "HOLD_REAFFIRM"]) {
      expect(driftDecision({ action, bullMaterial: 0, bearMaterial: 5 })).toEqual({
        shouldChallenge: false,
        level: "none",
      });
    }
  });
  it("does not challenge build actions when no bear signal", () => {
    expect(driftDecision({ action: "BUY", bullMaterial: 3, bearMaterial: 0 })).toEqual({
      shouldChallenge: false,
      level: "none",
    });
    expect(driftDecision({ action: "ADD", bullMaterial: 0, bearMaterial: 0 })).toEqual({
      shouldChallenge: false,
      level: "none",
    });
  });
  it("strong when bear dominates a build action", () => {
    expect(driftDecision({ action: "ADD", bullMaterial: 1, bearMaterial: 3 })).toEqual({
      shouldChallenge: true,
      level: "strong",
    });
    // bear present, bull zero → bear dominates → strong
    expect(driftDecision({ action: "BUY", bullMaterial: 0, bearMaterial: 1 }).level).toBe("strong");
  });
  it("soft when bear present but not dominant", () => {
    expect(driftDecision({ action: "BUY", bullMaterial: 3, bearMaterial: 1 })).toEqual({
      shouldChallenge: true,
      level: "soft",
    });
    expect(driftDecision({ action: "ADD", bullMaterial: 2, bearMaterial: 2 }).level).toBe("soft");
  });
});

describe("driftHeadline", () => {
  it("differs by level", () => {
    expect(driftHeadline("strong")).toContain("先停一下");
    expect(driftHeadline("soft")).toContain("对照");
  });
});

describe("fallbackChallenge", () => {
  it("includes name, original reason, the key question, and ends with user's call", () => {
    const msg = fallbackChallenge("中微公司", "看好国产替代逻辑");
    expect(msg).toContain("中微公司");
    expect(msg).toContain("看好国产替代逻辑");
    expect(msg).toContain("还是仅仅因为价格跌了");
    expect(msg).toContain("最终决策在你");
  });
  it("omits reason clause when none", () => {
    expect(fallbackChallenge("甲", null)).not.toContain("你当初记下的理由");
  });
});
