import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ThesisEarningsCheck } from "./thesis-earnings-check";
import { earningsCheckable } from "~/lib/earnings-check";

const dims = earningsCheckable([
  {
    key: "growth",
    watch: "新能源业务营收增速能否维持 30% 以上",
    bull: "营收同比加速",
    bear: "增速掉到 15% 以下",
  },
  { key: "margin", watch: "毛利率是否见底回升", bear: "价格战继续压毛利" },
]);

describe("ThesisEarningsCheck", () => {
  it("列出可被财报验证的维度及其兑现/恶化看点", () => {
    const html = renderToStaticMarkup(
      <ThesisEarningsCheck dimensions={dims} source="user" periodLabel="2026 年半年报" />,
    );
    expect(html).toContain("新能源业务营收增速");
    expect(html).toContain("营收同比加速");
    expect(html).toContain("增速掉到 15% 以下");
    expect(html).toContain("2026 年半年报");
  });

  it("标出命中的财务口径词——筛选依据要可见，不做黑箱", () => {
    const html = renderToStaticMarkup(
      <ThesisEarningsCheck dimensions={dims} source="user" />,
    );
    expect(html).toContain("营收");
    expect(html).toContain("毛利率");
  });

  it("用户自有逻辑说「你的」，共享框架说「这套框架」——所有权要说清", () => {
    const mine = renderToStaticMarkup(
      <ThesisEarningsCheck dimensions={dims} source="user" />,
    );
    const shared = renderToStaticMarkup(
      <ThesisEarningsCheck dimensions={dims} source="shared" />,
    );
    expect(mine).toContain("你的");
    expect(shared).toContain("框架");
    expect(shared).not.toContain("你的投资逻辑");
  });

  it("配色走 amber/灰阶——这是逻辑校验不是涨跌", () => {
    const html = renderToStaticMarkup(
      <ThesisEarningsCheck dimensions={dims} source="user" />,
    );
    expect(html).not.toContain("text-up");
    expect(html).not.toContain("text-down");
  });

  it("没有可验证维度时整卡不渲染", () => {
    expect(
      renderToStaticMarkup(<ThesisEarningsCheck dimensions={[]} source="user" />),
    ).toBe("");
  });
});
