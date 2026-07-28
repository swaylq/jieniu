import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ValuationContextCard } from "./valuation-context-card";

const ctx = {
  current: 66.6,
  percentile: 27,
  sampleSize: 480,
  industryMedian: 42.3,
  boardName: "白酒Ⅱ",
};
const html = renderToStaticMarkup(<ValuationContextCard ctx={ctx} />);

describe("ValuationContextCard", () => {
  it("给出当前 PE、历史分位与行业中位数三件参照物", () => {
    expect(html).toContain("66.6");
    expect(html).toContain("27");
    expect(html).toContain("42.3");
    expect(html).toContain("白酒Ⅱ");
  });

  it("分位条走 amber/灰阶——这是统计不是涨跌（铁律①）", () => {
    expect(html).toContain("bg-brand");
    expect(html).not.toContain("text-up");
    expect(html).not.toContain("text-down");
    expect(html).not.toContain("bg-up");
    expect(html).not.toContain("bg-down");
  });

  it("样本不足没有分位时，仍展示能给的部分", () => {
    const h = renderToStaticMarkup(
      <ValuationContextCard ctx={{ ...ctx, percentile: null }} />,
    );
    expect(h).toContain("42.3");
    expect(h).not.toContain("超过历史");
  });

  it("没有行业中位数时不显示对照行——不拿空值占位", () => {
    const h = renderToStaticMarkup(
      <ValuationContextCard ctx={{ ...ctx, industryMedian: null }} />,
    );
    expect(h).not.toContain("行业中位");
  });

  it("明确是客观统计、非估值判断", () => {
    expect(html).toContain("非");
    expect(html).toContain("不构成");
  });

  it("ctx 为 null 时整卡不渲染", () => {
    expect(renderToStaticMarkup(<ValuationContextCard ctx={null} />)).toBe("");
  });
});
