import { describe, expect, it } from "vitest";

import { buildAskContext, type AskMemory } from "./ask-context";

const base: AskMemory = {
  profile: null,
  holdings: [],
  theses: [],
  signals: [],
  decisions: [],
};

describe("buildAskContext", () => {
  it("无任何记忆 → hasMemory=false，文本说明未记录", () => {
    const out = buildAskContext(base);
    expect(out.hasMemory).toBe(false);
    expect(out.groundedHoldings).toEqual([]);
    expect(out.contextText).toContain("还没有记录");
  });

  it("有持仓 → hasMemory=true，文本含名称/代码，grounding 带 entityId", () => {
    const out = buildAskContext({
      ...base,
      holdings: [
        {
          entityId: "e1",
          name: "宁德时代",
          ticker: "300750",
          status: "HOLDING",
          costBasis: 180,
          weight: 20,
          note: "核心仓",
        },
      ],
    });
    expect(out.hasMemory).toBe(true);
    expect(out.contextText).toContain("宁德时代");
    expect(out.contextText).toContain("300750");
    expect(out.groundedHoldings).toEqual([
      { entityId: "e1", name: "宁德时代" },
    ]);
  });

  it("持仓数超过上限 → 截断到 12 且 grounding 同步截断", () => {
    const holdings = Array.from({ length: 20 }, (_, i) => ({
      entityId: `e${i}`,
      name: `股票${i}`,
      ticker: null,
      status: "HOLDING",
      costBasis: null,
      weight: null,
      note: null,
    }));
    const out = buildAskContext({ ...base, holdings });
    expect(out.groundedHoldings).toHaveLength(12);
  });

  it("信号按材料度过滤（<阈值剔除）并附方向中文", () => {
    const out = buildAskContext({
      ...base,
      holdings: [
        {
          entityId: "e1",
          name: "宁德时代",
          ticker: null,
          status: "HOLDING",
          costBasis: null,
          weight: null,
          note: null,
        },
      ],
      signals: [
        {
          name: "宁德时代",
          dimensionKey: "现金流",
          direction: "bull",
          materiality: 72,
          note: "回购",
        },
        {
          name: "宁德时代",
          dimensionKey: "毛利率",
          direction: "bear",
          materiality: 10, // 低于阈值，应剔除
          note: "小波动",
        },
      ],
    });
    expect(out.contextText).toContain("现金流");
    expect(out.contextText).toContain("偏兑现");
    expect(out.contextText).not.toContain("毛利率");
  });

  it("thesis 汇入 grounding 名称并进入上下文", () => {
    const out = buildAskContext({
      ...base,
      theses: [{ name: "比亚迪", summary: "电动车龙头逻辑" }],
    });
    expect(out.hasMemory).toBe(true);
    expect(out.groundedTheses).toEqual(["比亚迪"]);
    expect(out.contextText).toContain("电动车龙头逻辑");
  });

  it("只有画像也算有记忆", () => {
    const out = buildAskContext({
      ...base,
      profile: { style: "value", riskLevel: "balanced", summary: "偏左侧加仓" },
    });
    expect(out.hasMemory).toBe(true);
    expect(out.contextText).toContain("偏左侧加仓");
  });
});
