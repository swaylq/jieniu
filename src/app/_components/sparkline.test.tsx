import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Sparkline } from "./sparkline";

describe("Sparkline", () => {
  it("colors a rising series with up tokens + glow dot + baseline", () => {
    const html = renderToStaticMarkup(
      <Sparkline values={[1, 2, 3, 5]} ariaLabel="近3月走势" />,
    );
    expect(html).toContain("stroke-up");
    expect(html).toContain("bg-up"); // 末端发光点
    expect(html).toContain("stroke-dasharray"); // 基准虚线
    expect(html).toContain("近3月走势");
  });

  it("colors a falling series with down tokens", () => {
    const html = renderToStaticMarkup(<Sparkline values={[5, 3, 2, 1]} />);
    expect(html).toContain("stroke-down");
    expect(html).toContain("bg-down");
  });

  it("renders nothing for fewer than two points", () => {
    expect(renderToStaticMarkup(<Sparkline values={[1]} />)).toBe("");
  });
});
