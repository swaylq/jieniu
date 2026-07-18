import { describe, expect, it } from "vitest";

import { trackDimension } from "./logic-tracker";

const sig = (over: Partial<{ direction: string; materiality: number; note: string; publishedAt: Date }>) => ({
  direction: "bull",
  materiality: 50,
  note: "n",
  publishedAt: new Date("2026-07-01"),
  ...over,
});

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

  it("有材料级多头(40-69) → 部分验证 + 轻微增强", () => {
    const t = trackDimension([sig({ direction: "bull", materiality: 55 })]);
    expect(t.statusLabel).toBe("部分验证");
    expect(t.impact.label).toBe("轻微增强");
    expect(t.impact.tone).toBe("up");
  });

  it("有强多头(≥70) → 已验证 + 明显增强", () => {
    const t = trackDimension([sig({ direction: "bull", materiality: 80 })]);
    expect(t.statusLabel).toBe("已验证");
    expect(t.status).toBe("validated");
    expect(t.impact.label).toBe("明显增强");
  });

  it("材料级空头 → 状态仍按多头验证程度(未验证)，变化=削弱(ink，非红绿)", () => {
    const t = trackDimension([sig({ direction: "bear", materiality: 80 })]);
    expect(t.statusLabel).toBe("待验证"); // 有信号但多头未获验证
    expect(t.impact.label).toBe("明显削弱");
    expect(t.impact.tone).toBe("down");
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
});
