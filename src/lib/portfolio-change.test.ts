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

  // 兆易创新的形状（7-31）：6 条材料级 bull + 3 条 bear → 多数票判「增强」，
  // 那 3 条风险（大股东减持 44 亿）就此从「需要复核」里消失。方向可以只有一个，
  // 但两侧的条数必须都留着，否则复核卡永远是 0。
  it("多数票判了方向，但两侧条数都要留住——bear 不能被 bull 淹掉", () => {
    const r = rollUpHoldingChange("e1", "兆易创新", [
      sig("bull", 70),
      sig("bull", 65),
      sig("bear", 60, "减持"),
      sig("bear", 55, "减持"),
      sig("neutral", 50),
      sig("bear", 20, "小到不算"), // 低于材料度阈值，不计
    ]);
    expect(r.direction).toBe("strengthened");
    expect(r.bullCount).toBe(2);
    expect(r.bearCount).toBe(2);
    expect(r.materialCount).toBe(5);
    expect(r.topBearNote).toContain("减持");
  });

  it("没有材料级信号时两侧都是 0", () => {
    const r = rollUpHoldingChange("e1", "甲", [sig("bear", 10)]);
    expect(r.bullCount).toBe(0);
    expect(r.bearCount).toBe(0);
    expect(r.topBearNote).toBe("");
  });
});

const mk = (
  entityId: string,
  direction: PortfolioChangeItem["direction"],
  materialCount: number,
  extra: Partial<PortfolioChangeItem> = {},
): PortfolioChangeItem => ({
  entityId,
  name: entityId.toUpperCase(),
  direction,
  topDimension: direction === "unchanged" ? "" : "x",
  topNote: direction === "unchanged" ? "" : "n",
  topBearNote: "",
  materialCount,
  signalCount: materialCount + 1,
  bullCount: direction === "strengthened" ? materialCount : 0,
  bearCount: direction === "weakened" ? materialCount : 0,
  ...extra,
});

describe("partitionPortfolioChange", () => {
  it("changed (sorted by materialCount desc) before muted", () => {
    const { changed, muted } = partitionPortfolioChange([
      mk("a", "unchanged", 0),
      mk("b", "weakened", 1),
      mk("c", "strengthened", 3),
    ]);
    expect(changed.map((c) => c.entityId)).toEqual(["c", "b"]);
    expect(muted.map((m) => m.entityId)).toEqual(["a"]);
  });

  it("持仓排在观察前面——同样有变化时，你真金白银的那只更要紧", () => {
    const { changed } = partitionPortfolioChange([
      mk("w", "strengthened", 9, { status: "WATCH" }),
      mk("h", "strengthened", 1, { status: "HOLDING" }),
    ]);
    expect(changed.map((c) => c.entityId)).toEqual(["h", "w"]);
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

const item = (direction: PortfolioChangeItem["direction"]): PortfolioChangeItem =>
  mk("e", direction, 1);

describe("summarizeReview", () => {
  it("空组合 → total 0 + 提示添加自选", () => {
    const s = summarizeReview([]);
    expect(s.total).toBe(0);
    expect(s.headline).toContain("还没有");
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

  it("净增强但带 bear 的照样算进「风险信号」——跟首页复核卡同一把尺子", () => {
    const s = summarizeReview([mk("a", "strengthened", 5, { bullCount: 4, bearCount: 1 })]);
    expect(s.strengthened).toBe(1);
    expect(s.weakened).toBe(1);
  });
});
