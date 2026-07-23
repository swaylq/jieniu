import { describe, it, expect } from "vitest";
import {
  detectEventType,
  eventScore,
  scoreImportance,
  surfacingSince,
  SURFACING_WINDOW_DAYS,
} from "./importance";

describe("eventScore", () => {
  it("picks the highest matching event weight", () => {
    expect(eventScore("年度财报")).toBe(40);
    expect(eventScore("停牌公告")).toBe(45);
    expect(eventScore(null)).toBe(0);
    expect(eventScore("普通新闻")).toBe(0);
  });
});

describe("scoreImportance", () => {
  it("combines baseline + event + tier, clamped 0-100", () => {
    expect(scoreImportance({ tier: "PRIMARY", eventType: "停牌" })).toBe(90);
    expect(scoreImportance({ tier: "MEDIA", eventType: null })).toBe(30);
    expect(scoreImportance({ tier: "DERIVED", eventType: "普通" })).toBe(20);
  });
  it("clamps to at most 100", () => {
    expect(scoreImportance({ tier: "PRIMARY", eventType: "重大重组并购" })).toBeLessThanOrEqual(100);
  });
});

describe("detectEventType", () => {
  it("returns the highest-weight keyword found in text", () => {
    expect(detectEventType("中芯国际关于停牌的公告")).toBe("停牌");
    expect(detectEventType("2025年年度财报")).toBe("财报");
  });
  it("returns null when nothing matches", () => {
    expect(detectEventType("董事会议事规则")).toBeNull();
    expect(detectEventType(null)).toBeNull();
  });
});

describe("市场公告事件识别（一手全市场化后）", () => {
  it("识别重大公告类型", () => {
    expect(detectEventType("关于公司控制权拟发生变更的提示性公告")).toBe("控制权");
    expect(detectEventType("关于公司先行实施庭外重组的公告")).toBe("重组");
    expect(detectEventType("详式权益变动报告书")).toBe("权益变动");
    expect(detectEventType("关于公司被证监会立案的公告")).toBe("立案");
    expect(detectEventType("关于公司股票被实施退市风险警示的公告")).toBe("退市");
  });
  it("routine 公告标题不产生事件分，落在重大动态阈值(55)之下", () => {
    for (const t of [
      "关于召开2026年第一次临时股东大会会议资料",
      "股票交易异常波动公告",
    ]) {
      expect(detectEventType(t)).toBeNull();
      expect(scoreImportance({ tier: "PRIMARY", eventType: detectEventType(t) })).toBeLessThan(55);
    }
  });
  it("重大公告(PRIMARY)高于重大动态阈值", () => {
    expect(scoreImportance({ tier: "PRIMARY", eventType: "控制权" })).toBe(90);
    expect(scoreImportance({ tier: "PRIMARY", eventType: "权益变动" })).toBeGreaterThanOrEqual(55);
  });
});

describe("surfacingSince（重要性优先流的时间窗）", () => {
  it("起点是 now - SURFACING_WINDOW_DAYS 天", () => {
    const now = new Date("2026-07-23T12:00:00.000Z");
    const expected = now.getTime() - SURFACING_WINDOW_DAYS * 86_400_000;
    expect(surfacingSince(now).getTime()).toBe(expected);
  });

  it("回填进来的一年前重磅落在窗口外（不会霸占首页）", () => {
    const now = new Date("2026-07-23T12:00:00.000Z");
    const yearAgo = new Date(now.getTime() - 365 * 86_400_000);
    expect(yearAgo.getTime()).toBeLessThan(surfacingSince(now).getTime());
  });
});
