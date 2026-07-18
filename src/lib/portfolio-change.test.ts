import { describe, it, expect } from "vitest";
import {
  rollUpHoldingChange,
  partitionPortfolioChange,
  summarizeReview,
  changeTone,
  changeObservation,
  CHANGE_LABEL,
  type PortfolioChangeItem,
} from "./portfolio-change";

const sig = (direction: string, materiality: number, dimensionKey = "订单") => ({
  dimensionKey,
  direction,
  materiality,
  note: `${dimensionKey} ${direction}`,
});

describe("rollUpHoldingChange", () => {
  it("unchanged when no material signal (< threshold)", () => {
    const r = rollUpHoldingChange("e1", "甲", [sig("bull", 20), sig("bear", 30)]);
    expect(r.direction).toBe("unchanged");
    expect(r.materialCount).toBe(0);
    expect(r.signalCount).toBe(2);
  });
  it("strengthened when material bull dominates", () => {
    const r = rollUpHoldingChange("e1", "甲", [sig("bull", 60), sig("bull", 45), sig("bear", 50)]);
    expect(r.direction).toBe("strengthened");
    expect(r.materialCount).toBe(3);
  });
  it("weakened when material bear dominates", () => {
    const r = rollUpHoldingChange("e1", "甲", [sig("bear", 70, "毛利"), sig("bear", 55)]);
    expect(r.direction).toBe("weakened");
    expect(r.topDimension).toBe("毛利");
    expect(r.topNote).toContain("毛利");
  });
  it("breaks bull/bear tie by the most material signal", () => {
    const r = rollUpHoldingChange("e1", "甲", [sig("bull", 80), sig("bear", 50)]);
    expect(r.direction).toBe("strengthened");
  });
});

describe("partitionPortfolioChange", () => {
  it("changed (sorted by materialCount desc) before muted", () => {
    const items: PortfolioChangeItem[] = [
      { entityId: "a", name: "A", direction: "unchanged", topDimension: "", topNote: "", materialCount: 0, signalCount: 1 },
      { entityId: "b", name: "B", direction: "weakened", topDimension: "x", topNote: "n", materialCount: 1, signalCount: 2 },
      { entityId: "c", name: "C", direction: "strengthened", topDimension: "y", topNote: "n", materialCount: 3, signalCount: 4 },
    ];
    const { changed, muted } = partitionPortfolioChange(items);
    expect(changed.map((c) => c.entityId)).toEqual(["c", "b"]);
    expect(muted.map((m) => m.entityId)).toEqual(["a"]);
  });
});

describe("changeTone / labels / observation", () => {
  it("amber for strengthened, muted for weakened (no red/green)", () => {
    expect(changeTone("strengthened")).toBe("accent");
    expect(changeTone("weakened")).toBe("muted");
    expect(changeTone("unchanged")).toBe("muted");
  });
  it("every direction has a label; observation only for changed", () => {
    expect(CHANGE_LABEL.strengthened).toBe("逻辑增强");
    expect(CHANGE_LABEL.weakened).toBe("逻辑削弱");
    expect(CHANGE_LABEL.unchanged).toBe("逻辑未变");
    expect(changeObservation("strengthened")).toContain("复核");
    expect(changeObservation("weakened")).toContain("证伪");
    expect(changeObservation("unchanged")).toBe("");
  });
});

const item = (direction: PortfolioChangeItem["direction"]): PortfolioChangeItem => ({
  entityId: "e",
  name: "X",
  direction,
  topDimension: "订单",
  topNote: "n",
  materialCount: 1,
  signalCount: 1,
});

describe("summarizeReview", () => {
  it("空组合 → total 0 + 提示添加持仓", () => {
    const s = summarizeReview([]);
    expect(s.total).toBe(0);
    expect(s.headline).toContain("还没有持仓");
  });

  it("全无变化 → 计数正确 + 『无实质变化』文案", () => {
    const s = summarizeReview([item("unchanged"), item("unchanged")]);
    expect(s.unchanged).toBe(2);
    expect(s.strengthened).toBe(0);
    expect(s.headline).toContain("无实质变化");
  });

  it("混合 → 计数正确 + 文案含增强/风险", () => {
    const s = summarizeReview([
      item("strengthened"),
      item("strengthened"),
      item("weakened"),
      item("unchanged"),
    ]);
    expect(s.strengthened).toBe(2);
    expect(s.weakened).toBe(1);
    expect(s.unchanged).toBe(1);
    expect(s.total).toBe(4);
    expect(s.headline).toContain("2 只逻辑增强");
    expect(s.headline).toContain("1 只出现风险信号");
  });
});
