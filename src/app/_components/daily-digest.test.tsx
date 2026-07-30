import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DailyDigest, type DigestItem } from "./daily-digest";

// 早报卡副标的「近 N 小时」须与实际查询窗一致（QA loop run 41 维度 f）：
// 市场段 news.digest=24h、自选股段 news.personalDigest=48h。原来恒写「近 24 小时」却罩着 48h 的自选股段。
function di(id: string): DigestItem {
  return {
    id,
    title: `新闻${id}`,
    importance: 80,
    eventType: null,
    publishedAt: new Date("2026-07-28T00:00:00Z"),
    macro: false,
    source: { name: "东方财富·公告" },
  };
}

describe("DailyDigest 卡副标时间窗", () => {
  it("有自选股段 → 标「近 48 小时」（personalDigest 是 48h 窗，不能标成 24h）", () => {
    const html = renderToStaticMarkup(
      <DailyDigest personal={[di("a")]} market={[di("b")]} />,
    );
    expect(html).toContain("近 48 小时");
    expect(html).not.toContain("近 24 小时");
  });

  it("仅市场段（无自选股）→ 标「近 24 小时」", () => {
    const html = renderToStaticMarkup(<DailyDigest market={[di("b")]} />);
    expect(html).toContain("近 24 小时");
    expect(html).not.toContain("近 48 小时");
  });
});
