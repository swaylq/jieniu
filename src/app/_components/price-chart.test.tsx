import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PriceChart } from "./price-chart";

const series = (n: number) => Array.from({ length: n }, (_, i) => 10 + (i % 7));

describe("PriceChart", () => {
  it("renders all four range pills for a ~1Y series", () => {
    const html = renderToStaticMarkup(<PriceChart values={series(250)} />);
    for (const l of ["1月", "3月", "6月", "1年"]) expect(html).toContain(l);
  });

  it("limits pills to what a short series supports", () => {
    const html = renderToStaticMarkup(<PriceChart values={series(30)} />);
    expect(html).toContain("1月");
    expect(html).toContain("3月");
    expect(html).not.toContain("6月");
    expect(html).not.toContain("1年");
  });

  it("renders nothing without enough data", () => {
    expect(renderToStaticMarkup(<PriceChart values={[1]} />)).toBe("");
  });
});
