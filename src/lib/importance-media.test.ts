import { describe, it, expect } from "vitest";

import { scoreImportance, detectEventType } from "./importance";

// 回归：修复"媒体源永远达不到 importance≥55"的缺陷后，媒体带事件关键词应能进「重大动态」。
describe("媒体源重要性可达阈值", () => {
  it("媒体 + 强事件关键词（重组）得分 75，越过 55 门槛", () => {
    const et = detectEventType("某公司公告重大资产重组预案");
    expect(et).toBe("重组");
    expect(scoreImportance({ tier: "MEDIA", eventType: et })).toBe(75); // 20+45+10
  });

  it("媒体 + 回购 恰好达到 55", () => {
    expect(scoreImportance({ tier: "MEDIA", eventType: "回购" })).toBe(55); // 20+25+10
  });

  it("媒体无事件关键词维持 30（低于门槛，符合预期）", () => {
    expect(scoreImportance({ tier: "MEDIA", eventType: null })).toBe(30);
  });

  it("detectEventType 从摘要文本识别关键词", () => {
    expect(detectEventType("公司拟回购股份用于股权激励")).toBe("回购");
    expect(detectEventType("今日天气不错")).toBeNull();
  });
});
