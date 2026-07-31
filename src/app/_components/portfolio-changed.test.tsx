import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PortfolioChanged } from "./portfolio-changed";
import type { PortfolioChangeItem } from "~/lib/portfolio-change";

const muted: PortfolioChangeItem = {
  entityId: "abc123",
  name: "贵州茅台",
  direction: "unchanged",
  topDimension: "",
  topNote: "",
  topBearNote: "",
  materialCount: 0,
  signalCount: 0,
  bullCount: 0,
  bearCount: 0,
};

describe("PortfolioChanged 静音股名可点 (QA loop run 18 维度 a)", () => {
  it("静音股名链接到 /entity/{id}（此前是纯文本 join、点不进个股页）", () => {
    const html = renderToStaticMarkup(<PortfolioChanged items={[muted]} />);
    expect(html).toContain("已静音");
    expect(html).toContain("贵州茅台");
    expect(html).toContain('href="/entity/abc123"');
  });
});

describe("净增强里的偏风险动态要露出来 (2026-07-31)", () => {
  const mixed: PortfolioChangeItem = {
    entityId: "e1",
    name: "兆易创新",
    direction: "strengthened",
    topDimension: "订单",
    topNote: "公司公告上半年营收同比增长",
    topBearNote: "朱一明 5 月 6 日至 6 月 12 日合计减持约 44 亿元公司股份",
    materialCount: 9,
    signalCount: 17,
    bullCount: 6,
    bearCount: 3,
    status: "HOLDING",
  };

  it("多数票判成「增强」，但那 3 条 bear 必须在卡上看得见", () => {
    const html = renderToStaticMarkup(<PortfolioChanged items={[mixed]} />);
    expect(html).toContain("逻辑增强");
    expect(html).toContain("3 条偏风险");
    expect(html).toContain("减持约 44 亿元");
  });

  it("观察态标出来，别跟真金白银的持仓混为一谈", () => {
    const html = renderToStaticMarkup(
      <PortfolioChanged items={[{ ...mixed, status: "WATCH" }]} />,
    );
    expect(html).toContain("观察");
  });
});
