import { describe, it, expect } from "vitest";
import {
  digestSince,
  digestCaption,
  digestWindowHours,
  DIGEST_WINDOW_HOURS,
  PERSONAL_DIGEST_WINDOW_HOURS,
} from "./digest";

describe("digestSince", () => {
  it("returns a time exactly DIGEST_WINDOW_HOURS before now", () => {
    const now = new Date("2026-07-03T22:00:00.000Z");
    const since = digestSince(now);
    expect(now.getTime() - since.getTime()).toBe(
      DIGEST_WINDOW_HOURS * 60 * 60 * 1000,
    );
  });
});

describe("digestCaption", () => {
  it("reflects the shown count, not an inflated total", () => {
    expect(digestCaption(6)).toBe("近 24 小时 · 重磅 Top 6");
    expect(digestCaption(1)).toBe("近 24 小时 · 重磅 Top 1");
  });
});

// 早报卡副标的「近 N 小时」必须与实际查询窗一致（QA loop run 41 维度 f）：
// 市场段 news.digest 用 24h 窗；自选股段 news.personalDigest 放宽到 48h。
// 原来卡副标恒写「近 24 小时」却同时罩着 48h 的自选股段 → 对该段是错标。
describe("digestWindowHours", () => {
  it("有自选股段时返回 48h（personalDigest 实际放宽到 48h）", () => {
    expect(digestWindowHours(true)).toBe(PERSONAL_DIGEST_WINDOW_HOURS);
    expect(digestWindowHours(true)).toBe(48);
  });
  it("仅市场段时返回 24h（digest 是 24h 窗）", () => {
    expect(digestWindowHours(false)).toBe(DIGEST_WINDOW_HOURS);
    expect(digestWindowHours(false)).toBe(24);
  });
});
