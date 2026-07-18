import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NewsScorecard } from "./news-scorecard";
import { buildScorecard } from "~/lib/scorecard";

const data = buildScorecard({
  news30d: 12,
  hot30d: 6,
  peerNews30d: [1, 2, 3, 12],
  focusMasters: 2,
});
const html = renderToStaticMarkup(<NewsScorecard data={data} />);

describe("NewsScorecard", () => {
  it("renders the three news/attention dimensions", () => {
    for (const l of ["资讯热度", "重磅密度", "多视角相关"]) {
      expect(html).toContain(l);
    }
  });

  it("uses amber bars and 高/中/低 levels — never red/green price tokens", () => {
    expect(html).toContain("bg-brand/70");
    expect(html).toContain("高"); // heat=100 → 高
    expect(html).not.toContain("text-up");
    expect(html).not.toContain("text-down");
    expect(html).not.toContain("bg-up");
    expect(html).not.toContain("bg-down");
  });

  it("carries the compliance caption", () => {
    expect(html).toContain("非评级");
    expect(html).toContain("不预测涨跌");
  });
});
