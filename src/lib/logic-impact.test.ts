import { describe, expect, it } from "vitest";

import { classifyLogicImpact, impactBadgeClass } from "./logic-impact";

describe("classifyLogicImpact", () => {
  it("bull + 高材料度 → 明显增强 (up)", () => {
    expect(classifyLogicImpact({ direction: "bull", materiality: 85 })).toEqual({
      level: "strong_up",
      label: "明显增强",
      tone: "up",
    });
  });

  it("bull + 材料级(≥40,<70) → 轻微增强", () => {
    expect(classifyLogicImpact({ direction: "bull", materiality: 50 })).toMatchObject(
      { level: "mild_up", label: "轻微增强" },
    );
  });

  it("bull 但材料度过低(<40) → 无实质影响", () => {
    expect(
      classifyLogicImpact({ direction: "bull", materiality: 20 }).level,
    ).toBe("none");
  });

  it("bear + 高材料度 → 明显削弱 (down)", () => {
    expect(classifyLogicImpact({ direction: "bear", materiality: 90 })).toMatchObject(
      { level: "strong_down", label: "明显削弱", tone: "down" },
    );
  });

  it("bear + 材料级 → 轻微削弱", () => {
    expect(
      classifyLogicImpact({ direction: "bear", materiality: 45 }).level,
    ).toBe("mild_down");
  });

  it("方向不明但够材料 → 尚无法判断；不够材料 → 无实质影响", () => {
    expect(
      classifyLogicImpact({ direction: "neutral", materiality: 60 }).level,
    ).toBe("unclear");
    expect(
      classifyLogicImpact({ direction: "neutral", materiality: 10 }).level,
    ).toBe("none");
  });

  it("边界：材料度=阈值(40)算材料级，=强阈值(70)算明显", () => {
    expect(classifyLogicImpact({ direction: "bull", materiality: 40 }).level).toBe(
      "mild_up",
    );
    expect(classifyLogicImpact({ direction: "bull", materiality: 70 }).level).toBe(
      "strong_up",
    );
  });

  it("徽标颜色遵守铁律：增强=amber(brand)、削弱=ink、无实质=muted，无红绿", () => {
    expect(impactBadgeClass("up")).toContain("text-brand");
    expect(impactBadgeClass("down")).toContain("text-ink");
    expect(impactBadgeClass("neutral")).toContain("text-muted");
    for (const t of ["up", "down", "neutral"] as const) {
      expect(impactBadgeClass(t)).not.toMatch(/red|green/);
    }
  });
});
