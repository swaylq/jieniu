import { describe, it, expect } from "vitest";

import { relativeTime, summaryIsRedundant } from "./format";

describe("relativeTime", () => {
  const now = new Date("2026-07-02T12:00:00");
  it("shows 刚刚 for <60s and future timestamps", () => {
    expect(relativeTime(new Date("2026-07-02T11:59:30"), now)).toBe("刚刚");
    expect(relativeTime(new Date("2026-07-02T12:00:30"), now)).toBe("刚刚");
  });
  it("shows minutes and hours", () => {
    expect(relativeTime(new Date("2026-07-02T11:30:00"), now)).toBe("30分钟前");
    expect(relativeTime(new Date("2026-07-02T09:00:00"), now)).toBe("3小时前");
  });
  it("shows 昨天 and N天前", () => {
    expect(relativeTime(new Date("2026-07-01T12:00:00"), now)).toBe("昨天");
    expect(relativeTime(new Date("2026-06-29T12:00:00"), now)).toBe("3天前");
  });
  it("falls back to YYYY-MM-DD beyond ~30 days", () => {
    expect(relativeTime(new Date("2026-01-15T08:00:00"), now)).toBe(
      "2026-01-15",
    );
  });
});

describe("summaryIsRedundant", () => {
  it("hides identical / prefix / empty summaries", () => {
    expect(summaryIsRedundant("澜起科技公告", "澜起科技公告")).toBe(true);
    expect(summaryIsRedundant("完整标题很长", "完整标题")).toBe(true);
    expect(summaryIsRedundant("标题", "")).toBe(true);
  });
  it("keeps an informative summary", () => {
    expect(
      summaryIsRedundant("公司A获得订单", "据悉公司A今日签下大额芯片订单，金额可观"),
    ).toBe(false);
    expect(
      summaryIsRedundant("标题", "标题之后还有很多补充说明的信息内容"),
    ).toBe(false);
  });
});
