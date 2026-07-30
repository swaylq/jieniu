import { describe, expect, it } from "vitest";

import { trackDimension, isValidatingEvidence, type DimSignal } from "./logic-tracker";
import type { SourceLevel } from "./evidence-source";

const sig = (over: Partial<DimSignal> = {}): DimSignal => ({
  direction: "bull",
  materiality: 50,
  note: "n",
  publishedAt: new Date("2026-07-01"),
  ...over,
});

/** 够格支撑「已验证」的那种证据：一级来源 + 直接关于这家公司。 */
const hard = (over: Partial<DimSignal> = {}): DimSignal =>
  sig({ materiality: 80, sourceLevel: 1, grade: "direct", ...over });

describe("trackDimension", () => {
  it("无信号 → 未验证 + 无实质影响 + 无最新证据", () => {
    const t = trackDimension([]);
    expect(t.statusLabel).toBe("未验证");
    expect(t.status).toBe("untested");
    expect(t.impact.tone).toBe("neutral");
    expect(t.latest).toBeNull();
    expect(t.hitCount).toBe(0);
  });

  it("只有弱信号(材料度<40) → 待验证", () => {
    const t = trackDimension([sig({ materiality: 20 })]);
    expect(t.statusLabel).toBe("待验证");
    expect(t.status).toBe("watching");
  });

  it("最新证据取 publishedAt 最近的一条", () => {
    const t = trackDimension([
      sig({ note: "旧", publishedAt: new Date("2026-06-01") }),
      sig({ note: "新", publishedAt: new Date("2026-07-10") }),
    ]);
    expect(t.latest?.note).toBe("新");
    expect(t.hitCount).toBe(2);
  });

  it("变化取材料度最高的信号方向（多头弱+空头强 → 削弱）", () => {
    const t = trackDimension([
      sig({ direction: "bull", materiality: 45 }),
      sig({ direction: "bear", materiality: 85 }),
    ]);
    expect(t.statusLabel).toBe("部分验证"); // 有材料级多头
    expect(t.impact.tone).toBe("down"); // 但最强信号是空头 → 变化削弱
  });

  it("材料级空头 → 状态仍按多头验证程度(待验证)，变化=削弱(ink，非红绿)", () => {
    const t = trackDimension([sig({ direction: "bear", materiality: 80, sourceLevel: 1 })]);
    expect(t.statusLabel).toBe("待验证");
    expect(t.impact.label).toBe("明显削弱");
    expect(t.impact.tone).toBe("down");
  });
});

// 张楚寒 2026-07-30 第二轮：「『已验证』最好至少需要一条能够直接支持命题的一级至三级证据。
// 只有研报观点或者AI推断，最多标为『部分验证』。」
describe("trackDimension — 「已验证」的新门槛", () => {
  it("一级来源 + 直接支持命题 → 已验证", () => {
    const t = trackDimension([hard()]);
    expect(t.statusLabel).toBe("已验证");
    expect(t.statusWhy).toContain("一至三级证据");
  });

  it.each([1, 2, 3] as SourceLevel[])("%s 级来源都够格", (lv) => {
    expect(trackDimension([hard({ sourceLevel: lv })]).status).toBe("validated");
  });

  it("**材料度再高，只要来源是研报，也只能部分验证**（他点名的那一条）", () => {
    const t = trackDimension([hard({ materiality: 95, sourceLevel: 5 })]);
    expect(t.statusLabel).toBe("部分验证");
    expect(t.statusWhy).toContain("媒体/研报");
  });

  it("四级媒体报道同样只能部分验证", () => {
    expect(trackDimension([hard({ sourceLevel: 4 })]).status).toBe("partial");
  });

  it("来源够硬但只是旁证（同业/上游）→ 部分验证", () => {
    const t = trackDimension([hard({ grade: "supporting" })]);
    expect(t.statusLabel).toBe("部分验证");
    expect(t.statusWhy).toContain("旁证");
  });

  it("两头都差时，理由要把两条都说出来", () => {
    const t = trackDimension([
      hard({ sourceLevel: 5, grade: "direct" }),
      hard({ sourceLevel: 1, grade: "supporting" }),
    ]);
    expect(t.status).toBe("partial");
    expect(t.statusWhy).toContain("来源等级不足");
    expect(t.statusWhy).toContain("直接关于这家公司");
  });

  it("旧数据没有 sourceLevel/grade → 按媒体+旁证保守处理，不许升成已验证", () => {
    const t = trackDimension([sig({ materiality: 90 })]);
    expect(t.status).toBe("partial");
  });

  it("一条够格 + 一堆不够格 → 已验证（只要有一条硬的）", () => {
    const t = trackDimension([
      sig({ materiality: 90, sourceLevel: 5, grade: "direct" }),
      sig({ materiality: 90, sourceLevel: 4, grade: "supporting" }),
      hard({ materiality: 45 }),
    ]);
    expect(t.status).toBe("validated");
  });
});

describe("isValidatingEvidence — 三条缺一不可", () => {
  it("方向、材料度、来源等级、直接性，缺哪条都不算", () => {
    expect(isValidatingEvidence(hard())).toBe(true);
    expect(isValidatingEvidence(hard({ direction: "bear" }))).toBe(false);
    expect(isValidatingEvidence(hard({ materiality: 30 }))).toBe(false);
    expect(isValidatingEvidence(hard({ sourceLevel: 4 }))).toBe(false);
    expect(isValidatingEvidence(hard({ grade: "supporting" }))).toBe(false);
  });
});
