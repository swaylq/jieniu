import { describe, it, expect } from "vitest";
import { dimensionState, crossedState, DIM_STATE_LABEL } from "./dimension-state";

const s = (direction: string) => ({ direction });

describe("dimensionState", () => {
  it("bull-dominant → bullish, bear-dominant → bearish", () => {
    expect(dimensionState([s("bull"), s("bull"), s("bear")])).toBe("bullish");
    expect(dimensionState([s("bear"), s("bear")])).toBe("bearish");
  });
  it("tie or empty or all-neutral → neutral", () => {
    expect(dimensionState([s("bull"), s("bear")])).toBe("neutral");
    expect(dimensionState([])).toBe("neutral");
    expect(dimensionState([s("neutral"), s("neutral")])).toBe("neutral");
  });
});

describe("crossedState (宁少毋滥)", () => {
  it("crosses into a directional state", () => {
    expect(crossedState("neutral", "bearish")).toEqual({
      crossed: true,
      from: "neutral",
      to: "bearish",
    });
    expect(crossedState("bullish", "bearish").crossed).toBe(true); // flip
  });
  it("does NOT cross when softening to neutral or unchanged", () => {
    expect(crossedState("bearish", "neutral").crossed).toBe(false);
    expect(crossedState("bearish", "bearish").crossed).toBe(false);
    expect(crossedState("neutral", "neutral").crossed).toBe(false);
  });
});

describe("DIM_STATE_LABEL", () => {
  it("uses amber/gray vocabulary (兑现/风险/中性, not 涨跌)", () => {
    expect(DIM_STATE_LABEL.bullish).toBe("偏兑现");
    expect(DIM_STATE_LABEL.bearish).toBe("偏风险");
    expect(DIM_STATE_LABEL.neutral).toBe("中性");
  });
});
