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
  materialCount: 0,
  signalCount: 0,
};

describe("PortfolioChanged 静音股名可点 (QA loop run 18 维度 a)", () => {
  it("静音股名链接到 /entity/{id}（此前是纯文本 join、点不进个股页）", () => {
    const html = renderToStaticMarkup(<PortfolioChanged items={[muted]} />);
    expect(html).toContain("已静音");
    expect(html).toContain("贵州茅台");
    expect(html).toContain('href="/entity/abc123"');
  });
});
