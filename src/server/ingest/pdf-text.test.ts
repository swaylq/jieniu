import { describe, it, expect } from "vitest";

import { cleanPdfText } from "./pdf-text";

describe("cleanPdfText", () => {
  it("压缩行内多余空白与连续空行", () => {
    expect(cleanPdfText("第一条    总则\n\n\n\n第二条")).toBe(
      "第一条 总则\n\n第二条",
    );
  });

  it("去掉 \\r 与行尾空白", () => {
    expect(cleanPdfText("公告   \r\n正文\r\n")).toBe("公告\n正文");
  });

  it("首尾空白裁掉", () => {
    expect(cleanPdfText("\n\n  中芯国际  \n\n")).toBe("中芯国际");
  });
});
