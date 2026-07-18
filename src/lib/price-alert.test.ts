import { describe, it, expect } from "vitest";

import {
  shouldTriggerAlert,
  describeAlert,
  triggeredMessage,
} from "./price-alert";

describe("shouldTriggerAlert", () => {
  it("above triggers when price reaches or exceeds threshold", () => {
    expect(shouldTriggerAlert("above", 100, 100)).toBe(true);
    expect(shouldTriggerAlert("above", 100, 100.01)).toBe(true);
    expect(shouldTriggerAlert("above", 100, 99.99)).toBe(false);
  });

  it("below triggers when price reaches or drops under threshold", () => {
    expect(shouldTriggerAlert("below", 100, 100)).toBe(true);
    expect(shouldTriggerAlert("below", 100, 99.99)).toBe(true);
    expect(shouldTriggerAlert("below", 100, 100.01)).toBe(false);
  });

  it("never triggers on invalid threshold or price", () => {
    expect(shouldTriggerAlert("above", 0, 50)).toBe(false);
    expect(shouldTriggerAlert("above", NaN, 50)).toBe(false);
    expect(shouldTriggerAlert("below", 100, 0)).toBe(false);
    expect(shouldTriggerAlert("below", 100, -5)).toBe(false);
  });
});

describe("describeAlert / triggeredMessage", () => {
  it("phrases the alert condition neutrally (no advice)", () => {
    expect(describeAlert("above", 150)).toBe("涨破 150.00 元时提醒我");
    expect(describeAlert("below", 88.5)).toBe("跌破 88.50 元时提醒我");
  });

  it("phrases the triggered event as a fact", () => {
    expect(triggeredMessage("中芯国际", "above", 150, 151.2)).toBe(
      "中芯国际 现价 151.20 元，已涨破你设的 150.00 元",
    );
    expect(triggeredMessage("比亚迪", "below", 300, 298)).toBe(
      "比亚迪 现价 298.00 元，已跌破你设的 300.00 元",
    );
  });
});
