import { describe, expect, it } from "vitest";

import { newsAskQuestion } from "./news-ask";

describe("newsAskQuestion", () => {
  it("把标题包进「结合我的持仓/逻辑，对我意味着什么」的问句", () => {
    const q = newsAskQuestion("某公司发布回购公告");
    expect(q).toContain("某公司发布回购公告");
    expect(q).toContain("持仓");
    expect(q).toContain("逻辑");
  });

  it("超长标题截断加省略号，问句不至于过长", () => {
    const long = "标".repeat(120);
    const q = newsAskQuestion(long);
    expect(q).toContain("…");
    expect(q.length).toBeLessThan(160);
  });

  it("去除标题首尾空白", () => {
    expect(newsAskQuestion("  测试标题  ")).toContain("「测试标题」");
  });
});
