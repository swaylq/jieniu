import { describe, it, expect } from "vitest";
import {
  scanCompliance,
  isCompliant,
  withDisclaimer,
  DISCLAIMER,
} from "./compliance";

describe("scanCompliance", () => {
  it("flags buy/sell recommendations", () => {
    expect(
      scanCompliance("现在应该卖出").some((h) => h.label === "买卖建议"),
    ).toBe(true);
    expect(scanCompliance("建议买入该股").length).toBeGreaterThan(0);
    expect(scanCompliance("目前是买入时机").length).toBeGreaterThan(0);
  });

  it("flags price targets and return promises", () => {
    expect(
      scanCompliance("目标价看到 100 元").some((h) => h.label === "价格点位"),
    ).toBe(true);
    expect(
      scanCompliance("稳赚不赔").some((h) => h.label === "收益承诺"),
    ).toBe(true);
  });

  it("passes neutral educational text and value-investing philosophy", () => {
    expect(
      scanCompliance("该公司发布了年度业绩公告，营收同比增长。"),
    ).toEqual([]);
    expect(isCompliant("这是一段中性的信息解读，指出了不确定性。")).toBe(true);
    // 阐述投资理念（非荐股）应放行
    expect(
      isCompliant("巴菲特倾向于以合理价格买入优秀公司并长期持有。"),
    ).toBe(true);
  });
});

describe("withDisclaimer", () => {
  it("appends the disclaimer, idempotently", () => {
    const out = withDisclaimer("解读内容");
    expect(out).toContain(DISCLAIMER);
    expect(withDisclaimer(out)).toBe(out);
  });
});
