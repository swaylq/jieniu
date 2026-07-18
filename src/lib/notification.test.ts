import { describe, it, expect } from "vitest";

import { badgeText, notificationUnread } from "./format";

describe("badgeText", () => {
  it("常规数字原样返回", () => {
    expect(badgeText(0)).toBe("0");
    expect(badgeText(5)).toBe("5");
    expect(badgeText(99)).toBe("99");
  });

  it("超过 99 显示 99+", () => {
    expect(badgeText(100)).toBe("99+");
    expect(badgeText(1000)).toBe("99+");
  });
});

describe("notificationUnread", () => {
  const seen = new Date("2026-07-03T00:00:00Z");

  it("从未查看(水位线为空)→ 未读", () => {
    expect(notificationUnread(new Date("2026-01-01T00:00:00Z"), null)).toBe(true);
  });

  it("晚于水位线 → 未读", () => {
    expect(notificationUnread(new Date("2026-07-03T01:00:00Z"), seen)).toBe(true);
  });

  it("早于或等于水位线 → 已读", () => {
    expect(notificationUnread(new Date("2026-07-02T23:00:00Z"), seen)).toBe(
      false,
    );
    expect(notificationUnread(seen, seen)).toBe(false);
  });
});
