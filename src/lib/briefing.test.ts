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

const it_ = (bullCount: number, bearCount: number) => ({
  bullCount,
  bearCount,
  materialCount: bullCount + bearCount,
});

describe("briefingStats", () => {
  it("复核数 bear、增强数 bull、静音数无料——三者可重叠，不是划分", () => {
    const s = briefingStats([
      it_(0, 2), // 纯风险
      it_(3, 0), // 纯增强
      it_(4, 1), // 净增强但带风险：两边都要算
      it_(0, 0), // 无材料级动态
    ]);
    expect(s).toEqual({ review: 2, strengthened: 2, muted: 1, noticeable: 3 });
  });

  it("净增强里的 bear 不再被多数票埋掉（兆易创新的形状）", () => {
    expect(briefingStats([it_(6, 3)]).review).toBe(1);
  });

  it("空自选全 0", () => {
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
    expect(briefingHeadline(2, 5)).toBe("今天有 2 件事值得你注意。");
  });
  it("有自选但今天没料 → 平静文案，不虚张", () => {
    expect(briefingHeadline(0, 5)).toContain("平静");
    expect(briefingHeadline(0, 5)).not.toContain("值得你注意");
  });
  it("一只自选都没有 → 不许说「都很平静」（根本没盯任何东西）", () => {
    const h = briefingHeadline(0, 0);
    expect(h).not.toContain("平静");
    expect(h).toContain("自选");
  });
});

describe("briefingSubline", () => {
  it("无自选给引导语", () => {
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
