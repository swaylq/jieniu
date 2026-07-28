import { describe, it, expect } from "vitest";
import { formatGeneratedAt } from "./ai-stamp";

const now = new Date(2026, 6, 28, 11, 0);

describe("formatGeneratedAt", () => {
  it("同年只给 月/日 时:分——够定位新旧，不占地方", () => {
    expect(formatGeneratedAt(new Date(2026, 6, 27, 19, 59), now)).toBe("07/27 19:59");
  });

  it("补零，宽度稳定不跳动", () => {
    expect(formatGeneratedAt(new Date(2026, 0, 5, 9, 3), now)).toBe("01/05 09:03");
  });

  it("跨年的加上年份——「03/12」在跨年时会让人误以为是今年", () => {
    expect(formatGeneratedAt(new Date(2025, 2, 12, 8, 30), now)).toBe("2025/03/12 08:30");
  });

  it("接受 ISO 字符串（tRPC 过网后 Date 会变字符串）", () => {
    expect(formatGeneratedAt(new Date(2026, 6, 27, 19, 59).toISOString(), now)).toBe(
      "07/27 19:59",
    );
  });

  it("非法输入返回空串，让调用方直接不渲染", () => {
    expect(formatGeneratedAt("坏日期", now)).toBe("");
    expect(formatGeneratedAt(undefined, now)).toBe("");
    expect(formatGeneratedAt(null, now)).toBe("");
  });
});
