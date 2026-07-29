import { describe, it, expect } from "vitest";
import { shouldNarrate, buildPrompt } from "./narrate";

describe("shouldNarrate", () => {
  it("稳态成功不叫 AI（ingest 一天 48 轮，别烧钱）", () => {
    expect(shouldNarrate({ status: "ok", alerts: [], alwaysNarrate: false })).toBe(
      false,
    );
  });

  it("判据命中要叫", () => {
    expect(
      shouldNarrate({
        status: "ok",
        alerts: [{ id: "ingest-24h", message: "x", value: 0, threshold: 0 }],
        alwaysNarrate: false,
      }),
    ).toBe(true);
  });

  it("失败 / 超时 / 跳过都要叫", () => {
    for (const status of ["fail", "timeout", "skipped"] as const) {
      expect(shouldNarrate({ status, alerts: [], alwaysNarrate: false })).toBe(true);
    }
  });

  it("日级巡检全绿也要叫", () => {
    expect(shouldNarrate({ status: "ok", alerts: [], alwaysNarrate: true })).toBe(
      true,
    );
  });
});

describe("buildPrompt", () => {
  it("巡检类小结带上环比数字", () => {
    const p = buildPrompt({
      title: "日常维护",
      status: "ok",
      alerts: [],
      metrics: { pctNews7d: 84.1 },
      prevMetrics: { pctNews7d: 85.2 },
      output: "报表若干",
    });
    expect(p.user).toContain("85.2");
    expect(p.user).toContain("84.1");
  });

  it("提示词写明 AI 不负责判定成败", () => {
    const p = buildPrompt({
      title: "日常维护",
      status: "fail",
      alerts: [],
      metrics: null,
      prevMetrics: null,
      output: "boom",
    });
    expect(p.system).toContain("不要改判");
  });
});
