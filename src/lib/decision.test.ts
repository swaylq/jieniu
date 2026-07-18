import { describe, it, expect } from "vitest";
import {
  normalizeAction,
  actionTone,
  isValidReason,
  sortDecisionsDesc,
  ACTION_LABEL,
  DECISION_ACTIONS,
} from "./decision";

describe("normalizeAction", () => {
  it("keeps valid actions, defaults unknown to HOLD_REAFFIRM", () => {
    expect(normalizeAction("BUY")).toBe("BUY");
    expect(normalizeAction("SELL")).toBe("SELL");
    expect(normalizeAction("garbage")).toBe("HOLD_REAFFIRM");
    expect(normalizeAction(null)).toBe("HOLD_REAFFIRM");
  });
  it("every action has a label", () => {
    for (const a of DECISION_ACTIONS) expect(ACTION_LABEL[a]).toBeTruthy();
  });
});

describe("actionTone", () => {
  it("reduce-side is muted, build-side is accent (amber/gray, not red/green)", () => {
    expect(actionTone("BUY")).toBe("accent");
    expect(actionTone("ADD")).toBe("accent");
    expect(actionTone("HOLD_REAFFIRM")).toBe("accent");
    expect(actionTone("TRIM")).toBe("muted");
    expect(actionTone("SELL")).toBe("muted");
  });
});

describe("isValidReason", () => {
  it("requires non-empty trimmed, caps length", () => {
    expect(isValidReason("看好毛利率兑现")).toBe(true);
    expect(isValidReason("   ")).toBe(false);
    expect(isValidReason("")).toBe(false);
    expect(isValidReason("x".repeat(1001))).toBe(false);
  });
});

describe("sortDecisionsDesc", () => {
  it("newest first, stable by id at same instant", () => {
    const rows = [
      { id: "a", createdAt: "2026-07-01T00:00:00Z" },
      { id: "c", createdAt: "2026-07-03T00:00:00Z" },
      { id: "b", createdAt: "2026-07-02T00:00:00Z" },
    ];
    expect(sortDecisionsDesc(rows).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
  it("does not mutate input", () => {
    const rows = [
      { id: "a", createdAt: "2026-07-01T00:00:00Z" },
      { id: "b", createdAt: "2026-07-02T00:00:00Z" },
    ];
    sortDecisionsDesc(rows);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
