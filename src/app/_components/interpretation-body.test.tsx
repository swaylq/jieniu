import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InterpretationBody } from "./interpretation-body";

const SAMPLE = `【以下为「巴菲特」投资思维方式演示，非投资建议】

## 一句话看懂
- 公司拟收购标的，扩大护城河
- 短期现金流承压

## 这门生意的本质
正文内容。

—— 本内容由 AI 基于公开信息生成，仅供信息参考与投资者教育，不构成任何投资建议。市场有风险，决策需谨慎。`;

describe("InterpretationBody", () => {
  const html = renderToStaticMarkup(<InterpretationBody md={SAMPLE} />);

  it("renders a highlighted 一句话看懂 TL;DR card with its bullets", () => {
    expect(html).toContain("一句话看懂");
    expect(html).toContain("公司拟收购标的，扩大护城河");
    // amber (brand) card, not red/green — 符合颜色铁律
    expect(html).toContain("border-brand/30");
  });

  it("renders section headings and body text", () => {
    expect(html).toContain("这门生意的本质");
    expect(html).toContain("正文内容");
  });

  it("renders a standardized disclaimer block without the —— prefix", () => {
    expect(html).toContain("不构成任何投资建议");
    expect(html).toContain("ⓘ");
    expect(html).not.toContain("——");
  });
});
