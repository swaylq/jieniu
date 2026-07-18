import { describe, it, expect } from "vitest";
import { parseMarkdownLite, parseInline, extractTldr } from "./markdown-lite";

describe("parseMarkdownLite", () => {
  it("parses headings, bullets and paragraphs", () => {
    const b = parseMarkdownLite(
      "# 标题\n\n## 1. 小节\n\n- 要点一\n- 要点二\n\n正文段落",
    );
    expect(b[0]).toEqual({ type: "h1", text: "标题" });
    expect(b[1]).toEqual({ type: "h2", text: "1. 小节" });
    expect(b[2]).toEqual({ type: "ul", items: ["要点一", "要点二"] });
    expect(b[3]).toEqual({ type: "p", text: "正文段落" });
  });
  it("classifies 【…】 disclaimer as a note", () => {
    expect(parseMarkdownLite("【思维演示，非投资建议】")[0]!.type).toBe("note");
  });
  it("merges wrapped paragraph lines into one", () => {
    expect(parseMarkdownLite("第一行\n第二行")).toEqual([
      { type: "p", text: "第一行 第二行" },
    ]);
  });
});

describe("parseMarkdownLite disclaimer block", () => {
  it("classifies a —— prefixed line as a disclaimer block", () => {
    const b = parseMarkdownLite(
      "正文\n\n—— 本内容由 AI 生成，不构成任何投资建议。",
    );
    expect(b[b.length - 1]!.type).toBe("disclaimer");
  });
  it("keeps normal paragraphs as p", () => {
    expect(parseMarkdownLite("普通段落")[0]!.type).toBe("p");
  });
  it("drops horizontal-rule lines (---, ***, ___)", () => {
    expect(parseMarkdownLite("正文\n\n---\n\n更多")).toEqual([
      { type: "p", text: "正文" },
      { type: "p", text: "更多" },
    ]);
  });
});

describe("extractTldr", () => {
  it("pulls a 一句话看懂 heading + following bullets out of the blocks", () => {
    const { tldr, rest } = extractTldr(
      parseMarkdownLite("## 一句话看懂\n- 要点甲\n- 要点乙\n\n## 影响\n正文"),
    );
    expect(tldr).toEqual(["要点甲", "要点乙"]);
    expect(rest).toEqual([
      { type: "h2", text: "影响" },
      { type: "p", text: "正文" },
    ]);
  });
  it("accepts 速览 as a marker and a paragraph as content", () => {
    const { tldr } = extractTldr(
      parseMarkdownLite("## 速览\n一句话说清。\n\n## 正文\n内容"),
    );
    expect(tldr).toEqual(["一句话说清。"]);
  });
  it("finds the marker even after a leading 【…】 note (persona case)", () => {
    const { tldr } = extractTldr(
      parseMarkdownLite("【思维演示，非投资建议】\n\n## 一句话看懂\n- 甲\n\n## 正文\n内容"),
    );
    expect(tldr).toEqual(["甲"]);
  });
  it("returns null tldr and the same blocks when there is no marker", () => {
    const blocks = parseMarkdownLite("## 影响\n正文");
    const { tldr, rest } = extractTldr(blocks);
    expect(tldr).toBeNull();
    expect(rest).toBe(blocks);
  });
  it("returns null when the marker heading has no content block after it", () => {
    const { tldr } = extractTldr(parseMarkdownLite("## 一句话看懂\n\n## 影响\n正文"));
    expect(tldr).toBeNull();
  });
});

describe("parseInline", () => {
  it("splits bold segments", () => {
    expect(parseInline("这是**重点**内容")).toEqual([
      { text: "这是", bold: false },
      { text: "重点", bold: true },
      { text: "内容", bold: false },
    ]);
  });
  it("returns a single span when there is no bold", () => {
    expect(parseInline("普通文本")).toEqual([{ text: "普通文本", bold: false }]);
  });
});
