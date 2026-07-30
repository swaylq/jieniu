import { describe, it, expect } from "vitest";
import { isSubjectOnlySource, subjectOnlySourceNames } from "./subject-only";

// 这组测试钉住的是 2026-07-30 run2 的事故形状：存量清理脚本对结构化事件源跑标题启发式，
// 报出「2527 条错误绑定」，其中 龙虎榜 1363 + 大宗交易 1148 = 99.4% 是该保留的权威绑定。
describe("subjectOnly 源豁免名单", () => {
  it("结构化事件源全部在名单里——它们的主体由源权威给出", () => {
    for (const name of [
      "东方财富·龙虎榜",
      "东方财富·大宗交易",
      "东方财富·股东增减持",
      "东方财富·董监高增减持",
      "东方财富·业绩预告",
      "东方财富·券商研报",
    ]) {
      expect(isSubjectOnlySource(name), name).toBe(true);
    }
  });

  it("自然语言媒体源不在名单里——它们的绑定确实要靠文本启发式把关", () => {
    for (const name of [
      "东方财富·个股资讯",
      "东方财富·快讯",
      "华尔街见闻·A股",
      "东方财富·公告",
      "集微网",
    ]) {
      expect(isSubjectOnlySource(name), name).toBe(false);
    }
  });

  it("名单非空且取自源定义本身（新增结构化源自动受保护）", () => {
    expect(subjectOnlySourceNames().size).toBeGreaterThanOrEqual(6);
  });
});
