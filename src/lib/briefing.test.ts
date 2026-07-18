import { describe, it, expect } from "vitest";
import {
  greetingByHour,
  briefingStats,
  briefingHeadline,
  briefingSubline,
} from "./briefing";

describe("greetingByHour", () => {
  it("按时段返回问候语", () => {
    expect(greetingByHour(2)).toBe("夜深了");
    expect(greetingByHour(8)).toBe("早上好");
    expect(greetingByHour(14)).toBe("下午好");
    expect(greetingByHour(21)).toBe("晚上好");
  });
});

describe("briefingStats", () => {
  it("按方向汇总复核/增强/静音，noticeable=复核+增强", () => {
    const s = briefingStats([
      { direction: "weakened" },
      { direction: "strengthened" },
      { direction: "strengthened" },
      { direction: "unchanged" },
    ]);
    expect(s).toEqual({ review: 1, strengthened: 2, muted: 1, noticeable: 3 });
  });

  it("空持仓全 0", () => {
    expect(briefingStats([])).toEqual({
      review: 0,
      strengthened: 0,
      muted: 0,
      noticeable: 0,
    });
  });
});

describe("briefingHeadline", () => {
  it("有实质变化时给出件数", () => {
    expect(briefingHeadline(2)).toBe("今天有 2 件事值得你注意。");
  });
  it("全静时给平静文案，不虚张", () => {
    expect(briefingHeadline(0)).toContain("平静");
    expect(briefingHeadline(0)).not.toContain("值得你注意");
  });
});

describe("briefingSubline", () => {
  it("无持仓给引导语", () => {
    expect(briefingSubline(0, 0)).toContain("标记你的持仓");
  });
  it("有持仓无动态如实说没有", () => {
    expect(briefingSubline(12, 0)).toContain("没有触及投资逻辑");
  });
  it("有动态给真实条数", () => {
    expect(briefingSubline(12, 7)).toContain("12");
    expect(briefingSubline(12, 7)).toContain("7");
  });
});
