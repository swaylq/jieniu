import { describe, expect, it } from "vitest";

import {
  defaultAlertPrefs,
  normalizeAlertPrefs,
  alertReason,
  ALERT_CATEGORIES,
} from "./alert-protocol";

describe("alert prefs", () => {
  it("默认：逻辑/重磅/价格开，催化关（催化暂无数据源）", () => {
    const d = defaultAlertPrefs();
    expect(d.logic).toBe(true);
    expect(d.fundamental).toBe(true);
    expect(d.catalyst).toBe(false);
    expect(d.price).toBe(true); // #3b 到价提醒已上线
  });

  it("normalize 尊重 raw 的可用分类布尔、丢弃未知键、缺失填默认", () => {
    const p = normalizeAlertPrefs({ logic: false, fundamental: true, bogus: 1 });
    expect(p.logic).toBe(false);
    expect(p.fundamental).toBe(true);
    expect((p as Record<string, unknown>).bogus).toBeUndefined();
  });

  it("normalize 强制不可用分类(催化)为 false，可用分类(价格)尊重 raw", () => {
    const p = normalizeAlertPrefs({ price: false, catalyst: true });
    expect(p.catalyst).toBe(false); // 催化仍不可用，强制关
    expect(p.price).toBe(false); // 价格可用，尊重用户设的 false
    expect(normalizeAlertPrefs({ price: true }).price).toBe(true);
  });

  it("normalize 处理非对象输入 → 全默认", () => {
    expect(normalizeAlertPrefs(null)).toEqual(defaultAlertPrefs());
    expect(normalizeAlertPrefs("x")).toEqual(defaultAlertPrefs());
  });

  it("分类表含 4 类；价格已可用、催化仍标注不可用+原因", () => {
    expect(ALERT_CATEGORIES).toHaveLength(4);
    const price = ALERT_CATEGORIES.find((c) => c.key === "price")!;
    expect(price.available).toBe(true);
    const catalyst = ALERT_CATEGORIES.find((c) => c.key === "catalyst")!;
    expect(catalyst.available).toBe(false);
    expect(catalyst.soon).toBeTruthy();
  });
});

describe("alertReason", () => {
  it("转偏风险 → 提示对照证伪条件、先观察（不含买卖指令）", () => {
    const r = alertReason({ toState: "bearish", dimensionKey: "现金流" });
    expect(r).toContain("现金流");
    expect(r).toContain("证伪");
    expect(r).not.toMatch(/买入|卖出|加仓|减仓|清仓/);
  });

  it("转偏兑现 → 提示留意是否持续验证、勿追高（不含买卖指令）", () => {
    const r = alertReason({ toState: "bullish", dimensionKey: "订单" });
    expect(r).toContain("订单");
    expect(r).toMatch(/兑现|验证/);
    expect(r).not.toMatch(/买入|卖出|加仓|减仓|清仓/);
  });

  it("回中性 → 观察即可", () => {
    const r = alertReason({ toState: "neutral", dimensionKey: "毛利率" });
    expect(r).toContain("观察");
  });
});
