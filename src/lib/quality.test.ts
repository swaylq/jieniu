import { describe, it, expect } from "vitest";
import { cleanText, cleanInline, screenQuality } from "./quality";

describe("cleanText", () => {
  it("strips HTML tags and decodes entities", () => {
    expect(cleanText("<p>贵州茅台&amp;五粮液 &lt;涨&gt;</p>")).toBe(
      "贵州茅台&五粮液 <涨>",
    );
    expect(cleanText("A&#39;B &#x4e2d;")).toBe("A'B 中");
  });
  it("collapses spaces but keeps paragraph breaks", () => {
    expect(cleanText("第一段\n\n\n第二段")).toBe("第一段\n\n第二段");
    expect(cleanText("多   空格\t制表")).toBe("多 空格 制表");
  });
});

describe("cleanInline", () => {
  it("flattens all whitespace for titles/summaries", () => {
    expect(cleanInline("标题\n换行  多空格")).toBe("标题 换行 多空格");
  });
});

describe("screenQuality", () => {
  it("accepts normal news", () => {
    expect(screenQuality({ title: "比亚迪6月新建336座闪充站" }).ok).toBe(true);
  });
  it("rejects too-short / no-text titles", () => {
    expect(screenQuality({ title: "涨" }).ok).toBe(false);
    expect(screenQuality({ title: "2026-07-04" }).ok).toBe(false);
  });
  it("rejects ad / lead-gen content", () => {
    expect(screenQuality({ title: "利好来袭，扫码关注公众号领取金股" }).ok).toBe(
      false,
    );
    expect(
      screenQuality({ title: "重磅解读", summary: "点击下载APP查看全文" }).ok,
    ).toBe(false);
  });
  it("rejects garbled/encoding-broken text", () => {
    expect(screenQuality({ title: "��乱码标题" }).ok).toBe(false);
  });
});
