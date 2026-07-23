import { describe, it, expect } from "vitest";
import {
  isRatingHeadline,
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

describe("isRatingHeadline（研报评级/目标价，铁律②）", () => {
  it("拦下带评级与目标价的研报标题", () => {
    expect(isRatingHeadline("1季度业绩超预期，盈利维持韧性；维持买入")).toBe(true);
    expect(isRatingHeadline("首次覆盖，给予增持评级")).toBe(true);
    expect(isRatingHeadline("上调目标价至 320 元")).toBe(true);
    expect(isRatingHeadline("跑赢行业，龙头地位稳固")).toBe(true);
  });

  it("放行纯观察/点评类标题（研报作为事件收录）", () => {
    expect(isRatingHeadline("盈利能力表现稳健，市场份额稳中有升")).toBe(false);
    expect(isRatingHeadline("2026年一季报点评：营收和净利均高速增长")).toBe(false);
    expect(isRatingHeadline("技术迭代驱动多维增长，补能生态加速布局")).toBe(false);
  });

  it("不误伤把「增持/减持」当真实事件的标题", () => {
    expect(isRatingHeadline("控股股东增持股份计划公告")).toBe(false);
    expect(isRatingHeadline("关于股东股份减持计划完成的公告")).toBe(false);
  });
});
